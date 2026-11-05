/**
 * Description similarity and keyword overlap, used by the duplicate and
 * trigger-conflict rules. Deterministic and dependency-free.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with', 'when',
  'use', 'uses', 'using', 'skill', 'skills', 'agent', 'agents', 'task', 'tasks',
  '的', '了', '和', '与', '在', '是', '用', '使用', '任务', '技能',
])

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim()
}

export function tokens(text) {
  const normalized = normalize(text)
  if (!normalized) return new Set()
  const out = new Set()
  for (const word of normalized.split(' ')) {
    if (!word) continue
    if (/^[\p{Script=Han}]/u.test(word)) {
      if (word.length === 1) out.add(word)
      for (let index = 0; index < word.length - 1; index += 1) out.add(word.slice(index, index + 2))
    } else if (word.length > 2 && !STOPWORDS.has(word)) {
      out.add(word)
    }
  }
  return out
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const value of a) if (b.has(value)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function bigrams(text) {
  const normalized = normalize(text).replace(/ /g, '')
  const out = new Set()
  for (let index = 0; index < normalized.length - 1; index += 1) out.add(normalized.slice(index, index + 2))
  return out
}

/** 0..1 similarity of two skill descriptions. */
export function descriptionSimilarity(left, right) {
  const tokenScore = jaccard(tokens(left), tokens(right))
  const leftBigrams = bigrams(left)
  const rightBigrams = bigrams(right)
  let shared = 0
  for (const value of leftBigrams) if (rightBigrams.has(value)) shared += 1
  const dice = leftBigrams.size + rightBigrams.size === 0
    ? 0
    : (2 * shared) / (leftBigrams.size + rightBigrams.size)
  return Math.max(tokenScore, dice)
}

/** Overlap of the meaningful keywords in two skill descriptions. */
export function keywordOverlap(left, right) {
  const a = tokens(left)
  const b = tokens(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const value of a) if (b.has(value)) shared += 1
  return shared / Math.min(a.size, b.size)
}
