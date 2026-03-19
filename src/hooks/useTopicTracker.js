import { useState, useCallback } from 'react';

// Tokenize text into meaningful medical terms (simple approach)
function tokenize(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'this', 'that', 'these', 'those',
    'it', 'its', 'what', 'which', 'who', 'whom', 'how', 'when', 'where',
    'why', 'about', 'into', 'through', 'and', 'but', 'or', 'not', 'no',
    'so', 'if', 'then', 'than', 'too', 'very', 'just', 'also', 'more',
    'most', 'other', 'some', 'any', 'each', 'every', 'all', 'both',
    'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their',
    'paper', 'study', 'research', 'tell', 'explain', 'describe',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

// Group similar tokens into clusters using simple bigram matching
function clusterTokens(allTokens) {
  const freq = {};
  // Count individual terms
  for (const token of allTokens) {
    freq[token] = (freq[token] || 0) + 1;
  }
  // Count bigrams from original questions
  return freq;
}

export function useTopicTracker() {
  const [questions, setQuestions] = useState([]);
  const [topicCounts, setTopicCounts] = useState({});
  const [suggestedTopics, setSuggestedTopics] = useState([]);
  const [dismissedTopics, setDismissedTopics] = useState(new Set());

  const trackQuestion = useCallback((question) => {
    setQuestions((prev) => {
      const updated = [...prev, question];
      const allTokens = updated.flatMap(tokenize);
      const counts = clusterTokens(allTokens);
      setTopicCounts(counts);

      // Find topics with 3+ mentions that haven't been dismissed
      const suggestions = Object.entries(counts)
        .filter(([topic, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .map(([topic]) => topic);

      setSuggestedTopics(suggestions);
      return updated;
    });
  }, []);

  const dismissTopic = useCallback((topic) => {
    setDismissedTopics((prev) => new Set([...prev, topic]));
  }, []);

  const activeSuggestions = suggestedTopics.filter(
    (t) => !dismissedTopics.has(t)
  );

  return {
    trackQuestion,
    dismissTopic,
    topicCounts,
    suggestedTopics: activeSuggestions,
  };
}
