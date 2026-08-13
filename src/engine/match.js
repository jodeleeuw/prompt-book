// Deciding whether you have finished your line.
//
// There is no scoring here — the app is a scene partner, not a grader. All it
// needs is the moment your line ends, which is the last few words of it.
// Matching the tail rather than the whole line means a dramatic pause, a
// paraphrase in the middle, or a dropped clause all still land the cue.

const CONTRACTIONS = {
  "ain't": 'is not',
  "aren't": 'are not',
  "can't": 'cannot',
  "couldn't": 'could not',
  "didn't": 'did not',
  "doesn't": 'does not',
  "don't": 'do not',
  "hadn't": 'had not',
  "hasn't": 'has not',
  "haven't": 'have not',
  "he'd": 'he would',
  "he'll": 'he will',
  "he's": 'he is',
  "i'd": 'i would',
  "i'll": 'i will',
  "i'm": 'i am',
  "i've": 'i have',
  "isn't": 'is not',
  "it's": 'it is',
  "let's": 'let us',
  "shan't": 'shall not',
  "she'd": 'she would',
  "she'll": 'she will',
  "she's": 'she is',
  "shouldn't": 'should not',
  "that's": 'that is',
  "there's": 'there is',
  "they'd": 'they would',
  "they'll": 'they will',
  "they're": 'they are',
  "they've": 'they have',
  "wasn't": 'was not',
  "we'd": 'we would',
  "we'll": 'we will',
  "we're": 'we are',
  "we've": 'we have',
  "weren't": 'were not',
  "what's": 'what is',
  "won't": 'will not',
  "wouldn't": 'would not',
  "you'd": 'you would',
  "you'll": 'you will',
  "you're": 'you are',
  "you've": 'you have',
};

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
  if (n < 1000) {
    return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ''}`;
  }
  return String(n);
}

/**
 * Reduce script text and recogniser output to comparable tokens. The recogniser
 * writes "do not" where the script says "don't", and "20" where it says
 * "twenty", so both sides are expanded rather than compared as written.
 */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\b[a-z]+'[a-z]+\b/g, (word) => CONTRACTIONS[word] ?? word)
    .replace(/\d+/g, (digits) => numberToWords(Number(digits)))
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a, b) {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length];
}

// Recognisers mishear endings far more often than whole words, so tolerance
// scales with length: "battlements" may lose two letters, while "kin" must be
// exact. Short words are where slack does damage — "kin" and "kind" are one
// edit apart but sit at opposite ends of the same line, and treating them as
// the same word cues the run halfway through the speech.
function similar(a, b) {
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  const allowed = longest > 7 ? 2 : longest > 4 ? 1 : 0;
  return allowed > 0 && editDistance(a, b) <= allowed;
}

/**
 * Watch for the end of `text` in a transcript.
 *
 * The tail is slid over the whole transcript rather than anchored at its end,
 * because the recogniser often runs on into the next words before results
 * settle.
 */
export function createCueMatcher(text, { tailSize = 3 } = {}) {
  const tokens = normalize(text);
  const tail = tokens.slice(-Math.min(tailSize, tokens.length));
  // One miss is forgiven in a full-length tail; a one or two word tail is too
  // short to give anything away.
  const allowedMisses = tail.length >= 3 ? 1 : 0;

  const test = (transcript) => {
    if (!tail.length) return false;
    const heard = normalize(transcript);
    for (let start = 0; start + tail.length <= heard.length; start++) {
      let hits = 0;
      for (let k = 0; k < tail.length; k++) {
        if (similar(heard[start + k], tail[k])) hits++;
      }
      if (hits >= tail.length - allowedMisses) return true;
    }
    return false;
  };

  return { tail, test };
}
