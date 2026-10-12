/*
  The treasury key, made and sealed in the browser (docs/TECH-DECISIONS.md, Verified facts,
  12 Oct 2026). The company's spending key is a BIP-39 recovery phrase of 24 English words. The
  words are drawn from the browser's own randomness (crypto.getRandomValues through
  @scure/bip39 2.4.0), encrypted with the admin's passphrase in the age format
  (age-encryption 0.3.1, FiloSottile's typage: one scrypt stanza, work factor 2^18, ASCII
  armored), and only that ciphertext is sent to the service, which keeps it as its seed file
  (service/src/seed.rs decrypts it with the same passphrase, through the Rust age crate).

  What leaves this module in the clear: nothing. The phrase is shown once, on screen, for the
  admin to write down. Both libraries load on demand, so no other page carries them.
*/

/** The words of a BIP-39 phrase with 256 bits of entropy. */
export const PHRASE_WORDS = 24;

/** The service refuses a shorter passphrase (service/src/seed.rs); the form says so first. */
export const PASSPHRASE_MIN = 12;

/** The scrypt work factor (log2 N) the browser encrypts with: typage's default, and well inside what the service accepts. */
export const SCRYPT_WORK_FACTOR = 18;

/** The age armor's first line; what the service expects at the top of its seed file. */
export const AGE_ARMOR_HEAD = "-----BEGIN AGE ENCRYPTED FILE-----";

async function bip39() {
  const [lib, { wordlist }] = await Promise.all([import("@scure/bip39"), import("@scure/bip39/wordlists/english.js")]);
  return { ...lib, wordlist };
}

/** Lower case, one space between words, nothing around them: the form the service stores and checks. */
export function normalisePhrase(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

/** The words of a phrase, in order. */
export function phraseWords(raw: string): string[] {
  const n = normalisePhrase(raw);
  return n ? n.split(" ") : [];
}

/** A new 24-word phrase from the browser's randomness. */
export async function generatePhrase(): Promise<string> {
  const { generateMnemonic, wordlist } = await bip39();
  return generateMnemonic(wordlist, 256);
}

/**
 * Why a pasted phrase cannot be imported, in plain words, or null when it is a valid 24-word
 * English BIP-39 phrase (checksum included).
 */
export async function checkPhrase(raw: string): Promise<string | null> {
  const words = phraseWords(raw);
  if (words.length === 0) return "Paste the 24 words of the recovery phrase.";
  if (words.length !== PHRASE_WORDS) {
    return `That is ${words.length} ${words.length === 1 ? "word" : "words"}; a recovery phrase has ${PHRASE_WORDS}.`;
  }
  const { validateMnemonic, wordlist } = await bip39();
  const unknown = words.filter((w) => !wordlist.includes(w));
  if (unknown.length > 0) {
    const shown = unknown.slice(0, 3).join(", ");
    return `${unknown.length === 1 ? "This word is" : "These words are"} not in the BIP-39 English list: ${shown}${unknown.length > 3 ? ", and more" : ""}. Check the spelling.`;
  }
  if (!validateMnemonic(words.join(" "), wordlist)) {
    return "The words are all valid but the phrase's checksum is wrong: a word is out of place or mistyped.";
  }
  return null;
}

/** Why a passphrase will be refused, or null when it is long enough and both copies agree. */
export function checkPassphrase(passphrase: string, again: string): string | null {
  if (passphrase.length < PASSPHRASE_MIN) return `Use at least ${PASSPHRASE_MIN} characters.`;
  if (passphrase !== again) return "The two copies differ. Type the same passphrase in both.";
  return null;
}

/**
 * Three positions (1-based, ascending) to ask back after the words were shown, one from each
 * third of the phrase, so a check cannot pass by reading the top of the sheet alone.
 */
export function checkPositions(random: () => number = Math.random): number[] {
  const third = PHRASE_WORDS / 3;
  return [0, 1, 2].map((i) => i * third + Math.floor(random() * third) + 1);
}

/** Whether the words typed back match the phrase at `positions` (case and spacing forgiven). */
export function checkWordsMatch(phrase: string, positions: number[], typed: string[]): boolean {
  const words = phraseWords(phrase);
  return positions.every((p, i) => words[p - 1] !== undefined && words[p - 1] === normalisePhrase(typed[i] ?? ""));
}

/**
 * Seals the phrase with the passphrase: an age file with one scrypt stanza, ASCII armored, the
 * plaintext being the normalised phrase with no trailing newline. The service stores the text
 * as it is and decrypts it with `age::scrypt::Identity` (service/src/seed.rs).
 */
export async function encryptPhrase(phrase: string, passphrase: string): Promise<string> {
  const age = await import("age-encryption");
  const e = new age.Encrypter();
  e.setScryptWorkFactor(SCRYPT_WORK_FACTOR);
  e.setPassphrase(passphrase);
  const ciphertext = await e.encrypt(normalisePhrase(phrase));
  return age.armor.encode(ciphertext);
}

/**
 * Opens an armored ciphertext with the passphrase: the phrase back, or a thrown error. Used
 * before an upload, so what the service receives is known to open with the passphrase typed.
 */
export async function decryptPhrase(armored: string, passphrase: string): Promise<string> {
  const age = await import("age-encryption");
  const d = new age.Decrypter();
  d.addPassphrase(passphrase);
  return d.decrypt(age.armor.decode(armored), "text");
}
