//! Payment proofs: a contractor discloses one payment, and nothing else, to a third party.
//!
//! Every shielded output carries an `out_ciphertext` that the sender's outgoing viewing key can
//! open. The key that actually opens it is the per-output outgoing cipher key (`ock`), derived
//! from the OVK and that output's value commitment, note commitment and ephemeral key. Handing
//! someone the `ock` for one output lets them decrypt exactly that output's note (amount,
//! recipient, memo) and nothing else: not the other outputs of the transaction, not any other
//! transaction, and not the viewing key.
//!
//! The verifier fetches the transaction from the chain, decrypts the output with the `ock`, and
//! the note encryption library checks that the decrypted note re-commits to the note commitment
//! in the transaction. A proof therefore cannot be forged for a payment that did not happen.
//!
//! A proof token is `pp1` followed by unpadded base64url of:
//! `version (1) | network (1) | pool (1) | action index (2, big endian) | txid (32) | ock (32)`.

use anyhow::{anyhow, bail, Context};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use orchard::{
    keys::{OutgoingViewingKey, PreparedIncomingViewingKey},
    note_encryption::{DomainVersion, IronwoodVersion, NoteEncryptionDomain, OrchardVersion},
    Action, Address,
};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_note_encryption::{
    try_note_decryption, try_output_recovery_with_ock, Domain, OutgoingCipherKey, ShieldedOutput,
};
use zcash_primitives::transaction::{Transaction, TxId};
use zcash_protocol::consensus::Network;
use zip32::Scope;

const PREFIX: &str = "pp1";
const VERSION: u8 = 1;
const TOKEN_LEN: usize = 1 + 1 + 1 + 2 + 32 + 32;

/// The shielded pool an output was created in. Both are Orchard-shaped; Ironwood (NU6.3) notes
/// use plaintext version 3, so each needs its own decryption domain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pool {
    Orchard,
    Ironwood,
}

impl Pool {
    pub fn as_str(&self) -> &'static str {
        match self {
            Pool::Orchard => "orchard",
            Pool::Ironwood => "ironwood",
        }
    }
}

/// What a proof token carries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProofToken {
    pub mainnet: bool,
    pub pool: Pool,
    pub action_index: u16,
    pub txid: TxId,
    pub ock: [u8; 32],
}

impl ProofToken {
    pub fn encode(&self) -> String {
        let mut b = Vec::with_capacity(TOKEN_LEN);
        b.push(VERSION);
        b.push(if self.mainnet { 0 } else { 1 });
        b.push(match self.pool {
            Pool::Orchard => 0,
            Pool::Ironwood => 1,
        });
        b.extend_from_slice(&self.action_index.to_be_bytes());
        b.extend_from_slice(self.txid.as_ref());
        b.extend_from_slice(&self.ock);
        format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(b))
    }

    pub fn decode(s: &str) -> anyhow::Result<Self> {
        let body = s
            .trim()
            .strip_prefix(PREFIX)
            .ok_or_else(|| anyhow!("a payment proof starts with {PREFIX}"))?;
        let b = URL_SAFE_NO_PAD
            .decode(body)
            .map_err(|_| anyhow!("the proof is not valid base64url"))?;
        if b.len() != TOKEN_LEN {
            bail!("the proof has {} bytes, expected {TOKEN_LEN}", b.len());
        }
        if b[0] != VERSION {
            bail!("proof version {} is not supported by this build", b[0]);
        }
        let mainnet = match b[1] {
            0 => true,
            1 => false,
            n => bail!("unknown network byte {n}"),
        };
        let pool = match b[2] {
            0 => Pool::Orchard,
            1 => Pool::Ironwood,
            n => bail!("unknown pool byte {n}"),
        };
        let action_index = u16::from_be_bytes([b[3], b[4]]);
        let txid = TxId::from_bytes(b[5..37].try_into().expect("32 bytes"));
        let ock = b[37..69].try_into().expect("32 bytes");
        Ok(ProofToken {
            mainnet,
            pool,
            action_index,
            txid,
            ock,
        })
    }
}

/// One output of a transaction, opened.
#[derive(Clone, Debug)]
pub struct OpenedOutput {
    pub pool: Pool,
    pub action_index: u16,
    pub value_zat: u64,
    pub recipient: Address,
    pub memo: [u8; 512],
    pub ock: [u8; 32],
}

type SignedAction = Action<<orchard::bundle::Authorized as orchard::bundle::Authorization>::SpendAuth>;

fn bundles(tx: &Transaction) -> Vec<(Pool, Vec<&SignedAction>)> {
    let mut out = Vec::new();
    if let Some(b) = tx.orchard_bundle() {
        out.push((Pool::Orchard, b.actions().iter().collect()));
    }
    if let Some(b) = tx.ironwood_bundle() {
        out.push((Pool::Ironwood, b.actions().iter().collect()));
    }
    out
}

/// Opens every output this viewing key's account sent to someone else in `tx`, with the `ock`
/// that discloses each one. Outputs back to the same account (change) are left out.
pub fn sent_outputs(ufvk: &UnifiedFullViewingKey, tx: &Transaction) -> Vec<OpenedOutput> {
    let Some(fvk) = ufvk.orchard() else {
        return Vec::new();
    };
    let ovks = [fvk.to_ovk(Scope::External), fvk.to_ovk(Scope::Internal)];
    let ivks = [
        PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::External)),
        PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::Internal)),
    ];
    let mut out = Vec::new();
    for (pool, actions) in bundles(tx) {
        for (i, action) in actions.iter().enumerate() {
            let opened = match pool {
                Pool::Orchard => open_sent::<OrchardVersion, _>(action, &ovks, &ivks),
                Pool::Ironwood => open_sent::<IronwoodVersion, _>(action, &ovks, &ivks),
            };
            if let Some((value_zat, recipient, memo, ock)) = opened {
                out.push(OpenedOutput {
                    pool,
                    action_index: i as u16,
                    value_zat,
                    recipient,
                    memo,
                    ock,
                });
            }
        }
    }
    out
}

type Opened = (u64, Address, [u8; 512], [u8; 32]);

fn open_sent<V: DomainVersion, T>(
    action: &Action<T>,
    ovks: &[OutgoingViewingKey],
    ivks: &[PreparedIncomingViewingKey],
) -> Option<Opened> {
    let domain = NoteEncryptionDomain::<V>::for_action(action);
    // An output this account can decrypt as a recipient is its own (change or a self-payment).
    if ivks
        .iter()
        .any(|ivk| try_note_decryption(&domain, ivk, action).is_some())
    {
        return None;
    }
    let out_ct = &action.encrypted_note().out_ciphertext;
    ovks.iter().find_map(|ovk| {
        let ock = NoteEncryptionDomain::<V>::derive_ock(
            ovk,
            action.cv_net(),
            &ShieldedOutput::<NoteEncryptionDomain<V>>::cmstar_bytes(action),
            &ShieldedOutput::<NoteEncryptionDomain<V>>::ephemeral_key(action),
        );
        try_output_recovery_with_ock(&domain, &ock, action, out_ct)
            .map(|(note, recipient, memo)| (note.value().inner(), recipient, memo, ock.0))
    })
}

/// Opens the output a proof points at. Fails if the transaction has no such output or the key
/// does not open it, which is what a tampered or mismatched proof looks like.
pub fn open_with_proof(token: &ProofToken, tx: &Transaction) -> anyhow::Result<OpenedOutput> {
    let actions = bundles(tx)
        .into_iter()
        .find(|(p, _)| *p == token.pool)
        .map(|(_, a)| a)
        .ok_or_else(|| anyhow!("the transaction has no {} outputs", token.pool.as_str()))?;
    let action = actions
        .get(usize::from(token.action_index))
        .copied()
        .ok_or_else(|| anyhow!("the transaction has no output {}", token.action_index))?;
    let ock = OutgoingCipherKey(token.ock);
    let out_ct = &action.encrypted_note().out_ciphertext;
    let opened = match token.pool {
        Pool::Orchard => {
            let domain = NoteEncryptionDomain::<OrchardVersion>::for_action(action);
            try_output_recovery_with_ock(&domain, &ock, action, out_ct)
        }
        Pool::Ironwood => {
            let domain = NoteEncryptionDomain::<IronwoodVersion>::for_action(action);
            try_output_recovery_with_ock(&domain, &ock, action, out_ct)
        }
    };
    let (note, recipient, memo) = opened.context("the proof key does not open this output")?;
    Ok(OpenedOutput {
        pool: token.pool,
        action_index: token.action_index,
        value_zat: note.value().inner(),
        recipient,
        memo,
        ock: token.ock,
    })
}

/// The recipient as a unified address holding only its Orchard receiver (Ironwood notes are paid
/// to the same receiver), in the ZIP 316 Revision 0 form (`u1` / `utest1`) that released wallets
/// display.
pub fn recipient_address(params: &Network, recipient: Address) -> String {
    use zcash_address::unified::{self, Encoding as _};
    use zcash_protocol::consensus::Parameters;
    let items = vec![unified::Uitem::Data(unified::Receiver::Orchard(
        recipient.to_raw_address_bytes(),
    ))];
    unified::Address::try_from_items(unified::Revision::R0, items)
        .expect("an Orchard receiver alone is a valid unified address")
        .encode(&params.network_type())
}

/// Whether `address` (a unified address the verifier expected) contains this Orchard receiver.
pub fn address_matches(params: &Network, address: &str, recipient: &Address) -> Option<bool> {
    match zcash_keys::address::Address::decode(params, address.trim())? {
        zcash_keys::address::Address::Unified(ua) => Some(ua.orchard() == Some(recipient)),
        _ => Some(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_round_trips_and_rejects_tampering() {
        let t = ProofToken {
            mainnet: false,
            pool: Pool::Ironwood,
            action_index: 3,
            txid: TxId::from_bytes([7; 32]),
            ock: [9; 32],
        };
        let s = t.encode();
        assert!(s.starts_with("pp1"));
        assert_eq!(s.len(), 3 + 92);
        assert_eq!(ProofToken::decode(&s).unwrap(), t);
        assert_eq!(ProofToken::decode(&format!("  {s}\n")).unwrap(), t);
        assert!(ProofToken::decode(&s[..s.len() - 2]).is_err());
        assert!(ProofToken::decode(&s.replacen("pp1", "pp2", 1)).is_err());
        let mut bytes = URL_SAFE_NO_PAD.decode(&s[3..]).unwrap();
        bytes[0] = 2;
        assert!(ProofToken::decode(&format!("pp1{}", URL_SAFE_NO_PAD.encode(&bytes))).is_err());
    }
}
