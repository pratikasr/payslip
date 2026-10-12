//! The payer seed at rest (ADR-006, ADR-030): a BIP-39 mnemonic encrypted with age under a
//! passphrase. With `PAYSLIP_SEED_PASSPHRASE` set the service decrypts it at start; without it,
//! an admin unlocks it through the API for a few hours at a time. The decrypted seed lives only
//! in this process's memory.
//!
//! The file is an armored age file encrypted to a scrypt (passphrase) recipient, exactly what
//! `age -p -a` writes and what the `age-encryption` browser library produces, so a company can
//! encrypt its 24 words itself and upload the result (`POST /api/treasury/key`).

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context};
use bip0039::{Count, English, Mnemonic};
use secrecy::{ExposeSecret, SecretString};
use secrecy08::SecretVec;

/// What `GET /api/treasury/key` reports as the storage format.
pub const FORMAT: &str = "age scrypt, BIP-39 24 words";

const ARMOR_BEGIN: &str = "-----BEGIN AGE ENCRYPTED FILE-----";
const ARMOR_END: &str = "-----END AGE ENCRYPTED FILE-----";
/// An armored age file of 24 words is under 1 KB; anything near this is not one.
const MAX_CIPHERTEXT_BYTES: usize = 16 * 1024;

/// The passphrase did not decrypt the seed file. Callers tell it from every other failure
/// (`err.downcast_ref::<WrongPassphrase>()`) to answer with the right status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WrongPassphrase;

impl std::fmt::Display for WrongPassphrase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the passphrase does not decrypt the treasury seed")
    }
}

impl std::error::Error for WrongPassphrase {}

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
        let ciphertext = encrypt_phrase(phrase, passphrase)?;
        self.write_ciphertext(&ciphertext)
    }

    /// Writes an armored age file produced elsewhere (the browser, the `age` tool) as the seed
    /// file, readable by this user only. Refuses to overwrite. The content is checked to be an
    /// armored age file encrypted to a passphrase; without the passphrase nothing more can be
    /// checked.
    pub fn write_ciphertext(&self, ciphertext: &str) -> anyhow::Result<()> {
        validate_ciphertext(ciphertext)?;
        if self.path.exists() {
            bail!("{} already exists; refusing to overwrite a seed", self.path.display());
        }
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
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
        f.write_all(ciphertext.trim().as_bytes())?;
        f.write_all(b"\n")?;
        f.sync_all()?;
        Ok(())
    }

    /// Moves the seed file aside as `<name>.retired-<stamp>` (still readable by this user only)
    /// and returns the new path. The retired file keeps the old key: with its passphrase, any
    /// Zcash wallet can still recover that treasury and its contractor accounts.
    pub fn retire(&self, stamp: &str) -> anyhow::Result<PathBuf> {
        let retired = retired_path(&self.path, stamp);
        fs::rename(&self.path, &retired)
            .with_context(|| format!("retiring {} as {}", self.path.display(), retired.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&retired, fs::Permissions::from_mode(0o600))?;
        }
        Ok(retired)
    }

    /// When the file was written, as RFC 3339 UTC; None when it cannot be read.
    pub fn created_at(&self) -> Option<String> {
        let modified = fs::metadata(&self.path).ok()?.modified().ok()?;
        let t = time::OffsetDateTime::from(modified).replace_nanosecond(0).ok()?;
        t.format(&time::format_description::well_known::Rfc3339).ok()
    }

    /// Decrypts the 24-word mnemonic itself, for the operator to write down or type into
    /// another wallet. Only `seed-phrase` on the command line calls this; the API never does.
    pub fn phrase(&self, passphrase: &str) -> anyhow::Result<SecretString> {
        let ciphertext = fs::read(&self.path).with_context(|| format!("reading {}", self.path.display()))?;
        decrypt_phrase(&ciphertext, passphrase)
    }

    /// Decrypts the mnemonic and returns the 64-byte BIP-39 seed. A wrong passphrase is a
    /// [`WrongPassphrase`] error.
    pub fn unlock(&self, passphrase: &str) -> anyhow::Result<SecretVec<u8>> {
        seed_from_phrase(self.phrase(passphrase)?.expose_secret())
    }
}

/// `<path>.retired-<stamp>` next to the file.
pub fn retired_path(path: &Path, stamp: &str) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    path.with_file_name(format!("{name}.retired-{stamp}"))
}

/// Encrypts a mnemonic to a passphrase as an armored age file.
pub fn encrypt_phrase(phrase: &str, passphrase: &str) -> anyhow::Result<String> {
    let recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_string()));
    age::encrypt_and_armor(&recipient, phrase.as_bytes()).context("encrypting seed")
}

/// Checks that `ciphertext` is an armored age file encrypted to a passphrase (one scrypt
/// recipient), the only form the seed file takes. Says what is wrong in plain words.
pub fn validate_ciphertext(ciphertext: &str) -> anyhow::Result<()> {
    let text = ciphertext.trim();
    if text.len() > MAX_CIPHERTEXT_BYTES {
        bail!("the file is too large to be an encrypted 24-word phrase");
    }
    if !text.starts_with(ARMOR_BEGIN) || !text.ends_with(ARMOR_END) {
        bail!("not an armored age file: it must begin with {ARMOR_BEGIN} and end with {ARMOR_END}");
    }
    let reader = age::armor::ArmoredReader::new(text.as_bytes());
    let decryptor = age::Decryptor::new_buffered(reader).map_err(|e| anyhow::anyhow!("not a valid age file: {e}"))?;
    if !decryptor.is_scrypt() {
        bail!("the age file is not encrypted to a passphrase (it must have exactly one scrypt recipient)");
    }
    Ok(())
}

/// Decrypts an armored age file to the mnemonic it holds and checks the words. A wrong
/// passphrase is a [`WrongPassphrase`] error; anything else names the problem.
pub fn decrypt_phrase(ciphertext: &[u8], passphrase: &str) -> anyhow::Result<SecretString> {
    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_string()));
    let plaintext = match age::decrypt(&identity, ciphertext) {
        Ok(p) => p,
        Err(age::DecryptError::NoMatchingKeys) | Err(age::DecryptError::DecryptionFailed) => {
            return Err(anyhow::Error::new(WrongPassphrase))
        }
        Err(e) => bail!("could not read the seed file: {e}"),
    };
    let text = String::from_utf8(plaintext).context("seed file is not UTF-8")?;
    let phrase = SecretString::from(text.trim().to_string());
    <Mnemonic<English>>::from_phrase(phrase.expose_secret()).context("seed file holds an invalid mnemonic")?;
    Ok(phrase)
}

/// The 64-byte BIP-39 seed of a mnemonic (empty BIP-39 passphrase, as every Zcash wallet).
pub fn seed_from_phrase(phrase: &str) -> anyhow::Result<SecretVec<u8>> {
    let mnemonic = <Mnemonic<English>>::from_phrase(phrase.trim()).context("seed file holds an invalid mnemonic")?;
    Ok(SecretVec::new(mnemonic.to_seed("").to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy08::ExposeSecret as _;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    /// `age -p -a -o cli.age mnemonic.txt` (age 1.3.2, 12 Oct 2026) with the passphrase
    /// `correct horse battery` over PHRASE and a trailing newline: an armored file with one
    /// `scrypt` stanza at work factor 18. The browser's `age-encryption` library writes the same
    /// format. The phrase is the BIP-39 test vector, not a secret.
    const CLI_FIXTURE: &str = "-----BEGIN AGE ENCRYPTED FILE-----
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IHNjcnlwdCBDN2FWZ1FXQzJtV2NUckEx
cmhDSU1nIDE4CkNVUnlGQUVTQ1NuUW81WUpNc1dHblV2RXg2TXVHdS9qNUFlQzZJ
aVlPSWMKLS0tIHRYWjYzZHlyWElnRHQzQXdQbG9wWGE0RjlodUJ2UHNKWC9LMWZu
ZERNS3MKdNPT1FHJx9sl9BOSOtQNHCUZw8clN1PcekpsvRugbBK8icuWK/r4suHd
7I0zPjM555rCeBF06kYQG7tu480MquIyr0jsrA73OyGnIHIEyq4uemlwXb5J0GEx
sbyZ+IabNuXvxyr12PuAr8SeBjgljA507tiPMqI/rCN9qIj4yKc5pS6zb5nBonRS
3+EJK9wTDorCxJALAYa8kh5N7KR07CXoHVn2ctkOim5uJB5vEig2Ky4ODBnZk4XA
ntZd6xy8huv87+CQYYThTLmfOpz9XakoeUcQRmAYX3/dmw==
-----END AGE ENCRYPTED FILE-----
";

    #[test]
    fn create_unlock_and_refuse_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("payer.seed.age"));
        f.create("correct horse battery").unwrap();
        let seed = f.unlock("correct horse battery").unwrap();
        assert_eq!(seed.expose_secret().len(), 64);
        let wrong = f.unlock("wrong passphrase!!").err().expect("refused");
        assert!(wrong.downcast_ref::<WrongPassphrase>().is_some(), "{wrong:#}");
        assert!(f.create("correct horse battery").is_err());
        let raw = fs::read_to_string(f.path()).unwrap();
        assert!(raw.starts_with("-----BEGIN AGE ENCRYPTED FILE-----"));
    }

    #[test]
    fn the_phrase_comes_back_as_written() {
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("s.age"));
        f.import(PHRASE, "correct horse battery").unwrap();
        assert_eq!(f.phrase("correct horse battery").unwrap().expose_secret(), PHRASE);
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
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("s.age"));
        f.import(PHRASE, "correct horse battery").unwrap();
        let expected = <Mnemonic<English>>::from_phrase(PHRASE).unwrap().to_seed("");
        assert_eq!(
            f.unlock("correct horse battery").unwrap().expose_secret().as_slice(),
            &expected[..]
        );
    }

    /// ADR-030: a file the `age` command line tool encrypted with `-p` is accepted as the seed
    /// file, with the trailing newline the tool leaves after the words.
    #[test]
    fn a_file_from_the_age_cli_decrypts() {
        validate_ciphertext(CLI_FIXTURE).unwrap();
        let phrase = decrypt_phrase(CLI_FIXTURE.as_bytes(), "correct horse battery").unwrap();
        assert_eq!(phrase.expose_secret(), PHRASE);
        let wrong = decrypt_phrase(CLI_FIXTURE.as_bytes(), "not the passphrase").unwrap_err();
        assert!(wrong.downcast_ref::<WrongPassphrase>().is_some(), "{wrong:#}");
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("payer.seed.age"));
        f.write_ciphertext(CLI_FIXTURE).unwrap();
        let expected = <Mnemonic<English>>::from_phrase(PHRASE).unwrap().to_seed("");
        assert_eq!(
            f.unlock("correct horse battery").unwrap().expose_secret().as_slice(),
            &expected[..]
        );
        assert!(f.write_ciphertext(CLI_FIXTURE).is_err(), "never overwrites");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(f.path()).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    /// A file this crate's age encryption produced round-trips through the upload path, and
    /// things that are not a passphrase-encrypted age file are refused with the reason.
    #[test]
    fn rust_age_output_round_trips_and_other_input_is_refused() {
        let ciphertext = encrypt_phrase(PHRASE, "correct horse battery").unwrap();
        validate_ciphertext(&ciphertext).unwrap();
        assert_eq!(
            decrypt_phrase(ciphertext.as_bytes(), "correct horse battery")
                .unwrap()
                .expose_secret(),
            PHRASE
        );
        let e = validate_ciphertext("hello").unwrap_err().to_string();
        assert!(e.contains("not an armored age file"), "{e}");
        let garbage = format!("{ARMOR_BEGIN}\nbm90IGFuIGFnZSBmaWxl\n{ARMOR_END}");
        let e = validate_ciphertext(&garbage).unwrap_err().to_string();
        assert!(e.contains("not a valid age file"), "{e}");
        // Encrypted to an x25519 key, not a passphrase.
        let identity = age::x25519::Identity::generate();
        let to_key = age::encrypt_and_armor(&identity.to_public(), PHRASE.as_bytes()).unwrap();
        let e = validate_ciphertext(&to_key).unwrap_err().to_string();
        assert!(e.contains("not encrypted to a passphrase"), "{e}");
        let big = format!("{ARMOR_BEGIN}\n{}\n{ARMOR_END}", "A".repeat(MAX_CIPHERTEXT_BYTES));
        assert!(validate_ciphertext(&big).is_err());
        // A passphrase-encrypted file holding something other than 24 words.
        let recipient = age::scrypt::Recipient::new(SecretString::from("correct horse battery".to_string()));
        let not_words = age::encrypt_and_armor(&recipient, b"hello world").unwrap();
        let e = decrypt_phrase(not_words.as_bytes(), "correct horse battery").unwrap_err();
        assert!(e.downcast_ref::<WrongPassphrase>().is_none());
        assert!(e.to_string().contains("invalid mnemonic"), "{e:#}");
    }

    #[test]
    fn retire_moves_the_file_aside() {
        let dir = tempfile::tempdir().unwrap();
        let f = SeedFile::new(dir.path().join("payer.seed.age"));
        f.create("correct horse battery").unwrap();
        let retired = f.retire("20261012T101500Z").unwrap();
        assert_eq!(
            retired.file_name().unwrap().to_str().unwrap(),
            "payer.seed.age.retired-20261012T101500Z"
        );
        assert!(!f.exists() && retired.exists());
        let again = SeedFile::new(&retired);
        assert_eq!(again.unlock("correct horse battery").unwrap().expose_secret().len(), 64);
    }
}
