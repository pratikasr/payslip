//! In-memory compact block cache for `zcash_client_backend::sync::run`.
//!
//! The crates define the `BlockCache` trait but ship no implementation. Blocks are held only
//! for the duration of one scan batch; `sync::run` deletes each range after scanning it.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use async_trait::async_trait;
use zcash_client_backend::{
    data_api::{
        chain::{error::Error as ChainError, BlockCache, BlockSource},
        scanning::ScanRange,
    },
    proto::compact_formats::CompactBlock,
};
use zcash_protocol::consensus::BlockHeight;

#[derive(Debug, thiserror::Error)]
#[error("block cache: {0}")]
pub struct CacheError(String);

#[derive(Clone, Default)]
pub struct MemoryBlockCache {
    blocks: Arc<Mutex<BTreeMap<u32, CompactBlock>>>,
}

impl MemoryBlockCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn height(block: &CompactBlock) -> Result<u32, CacheError> {
        u32::try_from(block.height).map_err(|_| CacheError(format!("block height {} out of range", block.height)))
    }
}

impl BlockSource for MemoryBlockCache {
    type Error = CacheError;

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), ChainError<WalletErrT, Self::Error>>
    where
        F: FnMut(CompactBlock) -> Result<(), ChainError<WalletErrT, Self::Error>>,
    {
        let start = from_height.map(u32::from).unwrap_or(0);
        let blocks: Vec<CompactBlock> = {
            let guard = self.blocks.lock().map_err(|_| ChainError::BlockSource(CacheError("poisoned".into())))?;
            guard
                .range(start..)
                .take(limit.unwrap_or(usize::MAX))
                .map(|(_, b)| b.clone())
                .collect()
        };
        for block in blocks {
            with_block(block)?;
        }
        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemoryBlockCache {
    fn get_tip_height(&self, range: Option<&ScanRange>) -> Result<Option<BlockHeight>, Self::Error> {
        let guard = self.blocks.lock().map_err(|_| CacheError("poisoned".into()))?;
        let tip = match range {
            Some(r) => {
                let (s, e) = (u32::from(r.block_range().start), u32::from(r.block_range().end));
                guard.range(s..e).next_back().map(|(h, _)| *h)
            }
            None => guard.keys().next_back().copied(),
        };
        Ok(tip.map(BlockHeight::from_u32))
    }

    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, Self::Error> {
        let guard = self.blocks.lock().map_err(|_| CacheError("poisoned".into()))?;
        let (s, e) = (u32::from(range.block_range().start), u32::from(range.block_range().end));
        Ok(guard.range(s..e).map(|(_, b)| b.clone()).collect())
    }

    async fn insert(&self, compact_blocks: Vec<CompactBlock>) -> Result<(), Self::Error> {
        let mut guard = self.blocks.lock().map_err(|_| CacheError("poisoned".into()))?;
        for b in compact_blocks {
            guard.insert(Self::height(&b)?, b);
        }
        Ok(())
    }

    async fn delete(&self, range: ScanRange) -> Result<(), Self::Error> {
        let mut guard = self.blocks.lock().map_err(|_| CacheError("poisoned".into()))?;
        let (s, e) = (u32::from(range.block_range().start), u32::from(range.block_range().end));
        let keys: Vec<u32> = guard.range(s..e).map(|(h, _)| *h).collect();
        for k in keys {
            guard.remove(&k);
        }
        Ok(())
    }
}
