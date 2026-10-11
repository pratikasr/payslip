//! The payer seed at rest (ADR-006): a BIP-39 mnemonic encrypted with age under a passphrase
//! taken from the environment. The decrypted seed lives only in this process's memory.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context};
use bip0039::{Count, English, Mnemonic};
use secrecy::{ExposeSecret, SecretString};
use secrecy08::SecretVec;

pub struct SeedFile {
    path: PathBuf,
}

impl SeedFile {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        SeedFile { path: path.into() }
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Generates a new 24-word mnemonic and writes it encrypted. Refuses to overwrite.
    pub fn create(&self, passphrase: &str) -> anyhow::Result<()> {
        let mnemonic = <Mnemonic<English>>::generate(Count::Words24);
        self.write(mnemonic.phrase(), passphrase)
    }

    /// Writes an existing mnemonic encrypted. Refuses to overwrite.
    pub fn import(&self, phrase: &str, passphrase: &str) -> anyhow::Result<()> {
        let mnemonic = <Mnemonic<English>>::from_phrase(phrase.trim()).context("not a valid BIP-39 mnemonic")?;
        self.write(mnemonic.phrase(), passphrase)
    }

    fn write(&self, phrase: &str, passphrase: &str) -> anyhow::Result<()> {
        if passphrase.len() < 12 {
            bail!("PAYSLIP_SEED_PASSPHRASE must be at least 12 characters");
        }
        if self.path.exists() {
            bail!("{} already exists; refusing to overwrite a seed", self.path.display());
        }
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_string()));
        let ciphertext = age::encrypt_and_armor(&recipient, phrase.as_bytes()).context("encrypting seed")?;
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts
            .open(&self.path)
            .with_context(|| format!("creating {}", self.path.display()))?;
        f.write_all(ciphertext.as_bytes())?;
        f.sync_all()?;
        Ok(())
    }

    /// Decrypts the 24-word mnemonic itself, for the operator to write down or type into
    /// another wallet. Only `seed-phrase` on the command line calls this; the API never does.
    pub fn phrase(&self, passphrase: &str) -> anyhow::Result<SecretString> {
        let ciphertext = fs::read(&self.path).with_context(|| format!("reading {}", self.path.display()))?;
        let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_string()));
        let plaintext = age::decrypt(&identity, &ciphertext)
            .map_err(|_| anyhow::anyhow!("could not decrypt the seed file: wrong PAYSLIP_SEED_PASSPHRASE?"))?;
        let phrase = SecretString::from(String::from_utf8(plaintext).context("seed file is not UTF-8")?);
        <Mnemonic<English>>::from_phrase(phrase.expose_secret()).context("seed file holds an invalid mnemonic")?;
        Ok(phrase)
    }

    /// Decrypts the mnemonic and returns the 64-byte BIP-39 seed.
    pub fn unlock(&self, passphrase: &str) -> anyhow::Result<SecretVec<u8>> {
        let phrase = self.phrase(passphrase)?;
        let mnemonic =
            <Mnemonic<English>>::from_phrase(phrase.expose_secret()).context("seed file holds an invalid mnemonic")?;
        Ok(SecretVec::new(mnemonic.to_seed("").to_vec()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy08::ExposeSecret as _;

    #[test]
    fn create_unlock_and_refuse_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("payer.seed.age"));
        f.create("correct horse battery").unwrap();
        let seed = f.unlock("correct horse battery").unwrap();
        assert_eq!(seed.expose_secret().len(), 64);
        assert!(f.unlock("wrong passphrase!!").is_err());
        assert!(f.create("correct horse battery").is_err());
        let raw = fs::read_to_string(f.path()).unwrap();
        assert!(raw.starts_with("-----BEGIN AGE ENCRYPTED FILE-----"));
    }

    #[test]
    fn the_phrase_comes_back_as_written() {
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("s.age"));
        f.import(phrase, "correct horse battery").unwrap();
        assert_eq!(f.phrase("correct horse battery").unwrap().expose_secret(), phrase);
        assert!(f.phrase("wrong passphrase!!").is_err());
    }

    #[test]
    fn short_passphrase_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("s.age"));
        assert!(f.create("short").is_err());
    }

    #[test]
    fn import_is_deterministic() {
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("s.age"));
        f.import(phrase, "correct horse battery").unwrap();
        let expected = <Mnemonic<English>>::from_phrase(phrase).unwrap().to_seed("");
        assert_eq!(
            f.unlock("correct horse battery").unwrap().expose_secret().as_slice(),
            &expected[..]
        );
    }
}
