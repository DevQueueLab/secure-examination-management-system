import type { Difficulty, QuestionType } from '@athena/shared';

export interface SeedQuestion {
  ref: string;
  category: string;
  type: QuestionType;
  difficulty: Difficulty;
  title: string;
  marks: number;
  tags?: string[];
  content: Record<string, unknown>;
  key: Record<string, unknown>;
  rubric?: { target?: 'answer' | 'working'; label: string; points: number; description?: string }[];
}

const o = (...texts: string[]) => texts.map((text, i) => ({ id: `o${i + 1}`, text }));

export const SEED_QUESTIONS: SeedQuestion[] = [
  // ---------- Data Structures: pool of 2-mark fundamentals ----------
  { ref: 'ds-binsearch', category: 'Data Structures', type: 'single_choice', difficulty: 'easy', title: 'Binary search complexity', marks: 2,
    content: { stem: 'What is the worst-case time complexity of binary search on a sorted array of $n$ elements?', options: o('$O(1)$', '$O(\\log n)$', '$O(n)$', '$O(n \\log n)$'), explanation: 'Each step halves the search interval.' },
    key: { correct: 'o2' } },
  { ref: 'ds-bfs', category: 'Data Structures', type: 'single_choice', difficulty: 'easy', title: 'BFS frontier structure', marks: 2,
    content: { stem: 'Which data structure holds the frontier in a breadth-first search?', options: o('Stack', 'Queue', 'Priority queue', 'Hash set') },
    key: { correct: 'o2' } },
  { ref: 'ds-heap-parent', category: 'Data Structures', type: 'single_choice', difficulty: 'medium', title: 'Heap parent index', marks: 2,
    content: { stem: 'In a binary heap stored in a 1-indexed array, the parent of the node at index $i$ is at:', options: o('$2i$', '$2i + 1$', '$\\lfloor i/2 \\rfloor$', '$i - 1$') },
    key: { correct: 'o3' } },
  { ref: 'ds-hash-tf', category: 'Data Structures', type: 'true_false', difficulty: 'medium', title: 'Hash table worst case', marks: 2,
    content: { stem: 'A hash table guarantees $O(1)$ lookup time in the worst case.', explanation: 'Collisions can degrade lookups to $O(n)$.' },
    key: { correct: false } },
  { ref: 'ds-avl-tf', category: 'Data Structures', type: 'true_false', difficulty: 'easy', title: 'AVL trees are BSTs', marks: 2,
    content: { stem: 'Every AVL tree is also a binary search tree.' },
    key: { correct: true } },
  { ref: 'ds-lifo', category: 'Data Structures', type: 'short_text', difficulty: 'easy', title: 'LIFO structure', marks: 2,
    content: { stem: 'Name the data structure that removes elements in last-in, first-out (LIFO) order.', maxLength: 40 },
    key: { accepted: ['stack', 'a stack'], caseSensitive: false } },
  { ref: 'ds-rb-height', category: 'Data Structures', type: 'single_choice', difficulty: 'hard', title: 'Red-black tree height bound', marks: 2,
    content: { stem: 'The height of a red-black tree with $n$ internal nodes is at most:', options: o('$\\log_2 n$', '$2\\log_2(n+1)$', '$n/2$', '$\\sqrt{n}$') },
    key: { correct: 'o2' } },
  { ref: 'ds-trie', category: 'Data Structures', type: 'single_choice', difficulty: 'hard', title: 'Trie lookup cost', marks: 2,
    content: { stem: 'Looking up a key of length $m$ in a trie holding $n$ keys takes:', options: o('$O(\\log n)$', '$O(m)$', '$O(n)$', '$O(m \\log n)$') },
    key: { correct: 'o2' } },

  // ---------- Algorithms ----------
  { ref: 'alg-stable', category: 'Algorithms', type: 'multiple_choice', difficulty: 'medium', title: 'Stable sorting algorithms', marks: 4,
    content: { stem: 'Which of these sorting algorithms are **stable** in their standard form? Select all that apply.', options: o('Merge sort', 'Quick sort', 'Insertion sort', 'Heap sort', 'Bubble sort', 'Selection sort') },
    key: { correct: ['o1', 'o3', 'o5'] } },
  { ref: 'alg-tree-nodes', category: 'Algorithms', type: 'numeric', difficulty: 'medium', title: 'Maximum nodes in a binary tree', marks: 3,
    content: { stem: 'A binary tree has height {{h}} (the root is at height 0). What is the **maximum** number of nodes it can contain?', variables: [{ name: 'h', min: 3, max: 7, step: 1 }],
      working: { enabled: true, marks: 2, guidance: 'Show how you count the nodes level by level.' } },
    key: { answer: null, formula: '2^(h+1) - 1', tolerance: { type: 'absolute', value: 0 } },
    rubric: [
      { target: 'working', label: 'Counts nodes per level as powers of two', points: 1 },
      { target: 'working', label: 'Sums the geometric series correctly', points: 1 },
    ] },
  { ref: 'alg-dijkstra', category: 'Algorithms', type: 'fill_blanks', difficulty: 'medium', title: 'Shortest paths and negative weights', marks: 4,
    content: { stem: 'Complete the statement.', template: "Dijkstra's algorithm can return wrong answers when a graph has [[b1]] edge weights. The [[b2]] algorithm handles them, as long as there is no negative cycle.", blanks: [{ id: 'b1' }, { id: 'b2' }] },
    key: { blanks: { b1: ['negative'], b2: ['Bellman-Ford', 'Bellman Ford', 'BellmanFord'] }, caseSensitive: false } },
  { ref: 'alg-complexity-match', category: 'Algorithms', type: 'matching', difficulty: 'medium', title: 'Match algorithms to complexity', marks: 4,
    content: { stem: 'Match each algorithm with its worst-case time complexity.', prompts: o('Merge sort', 'Binary search', 'Linear search', 'Naive matrix multiplication'), answers: [
      { id: 'a1', text: '$O(n \\log n)$' }, { id: 'a2', text: '$O(\\log n)$' }, { id: 'a3', text: '$O(n)$' }, { id: 'a4', text: '$O(n^3)$' }, { id: 'a5', text: '$O(1)$' }] },
    key: { pairs: { o1: 'a1', o2: 'a2', o3: 'a3', o4: 'a4' } } },
  { ref: 'alg-growth-order', category: 'Algorithms', type: 'ordering', difficulty: 'medium', title: 'Order functions by growth', marks: 3,
    content: { stem: 'Arrange these functions from **slowest** to **fastest** growing.', items: [
      { id: 'i1', text: '$\\log n$' }, { id: 'i2', text: '$n$' }, { id: 'i3', text: '$n \\log n$' }, { id: 'i4', text: '$n^2$' }, { id: 'i5', text: '$2^n$' }] },
    key: { order: ['i1', 'i2', 'i3', 'i4', 'i5'] } },
  { ref: 'alg-palindrome', category: 'Algorithms', type: 'code', difficulty: 'medium', title: 'Palindrome check', marks: 6,
    content: { stem: 'Write a function `is_palindrome(s)` that returns `True` when `s` reads the same forwards and backwards, **ignoring case and non-alphanumeric characters**. Aim for $O(n)$ time and $O(1)$ extra space.', language: 'python', starterCode: 'def is_palindrome(s: str) -> bool:\n    # your code here\n    pass\n' },
    key: { sampleAnswer: 'def is_palindrome(s):\n    i, j = 0, len(s) - 1\n    while i < j:\n        if not s[i].isalnum(): i += 1; continue\n        if not s[j].isalnum(): j -= 1; continue\n        if s[i].lower() != s[j].lower(): return False\n        i += 1; j -= 1\n    return True' },
    rubric: [
      { label: 'Correctly ignores case', points: 1 },
      { label: 'Correctly skips non-alphanumeric characters', points: 2 },
      { label: 'Two-pointer O(1) space approach', points: 2 },
      { label: 'Handles empty string / single character', points: 1 },
      { label: 'Off-by-one or crash on edge input', points: -1 },
    ] },

  // ---------- Operating systems / written ----------
  { ref: 'os-process-thread', category: 'Operating Systems', type: 'long_text', difficulty: 'hard', title: 'Processes vs threads', marks: 6,
    content: { stem: 'Explain the difference between a **process** and a **thread**. Give one concrete situation where using threads is preferable, and one risk that threads introduce.', minWords: 60, maxWords: 400 },
    key: { sampleAnswer: 'A process has its own address space and resources; threads share the address space of their process...' },
    rubric: [
      { label: 'Process: own address space and resources', points: 2 },
      { label: 'Thread: shares memory, own stack and registers', points: 2 },
      { label: 'Valid situation where threads are preferable', points: 1 },
      { label: 'Names a real risk (races, deadlock)', points: 1 },
      { label: 'Factual error', points: -1 },
    ] },
  { ref: 'os-compile-order', category: 'Operating Systems', type: 'ordering', difficulty: 'easy', title: 'Stages of building a C program', marks: 3,
    content: { stem: 'Order the stages that turn a C source file into an executable.', items: [
      { id: 'i1', text: 'Preprocessing' }, { id: 'i2', text: 'Compilation' }, { id: 'i3', text: 'Assembly' }, { id: 'i4', text: 'Linking' }] },
    key: { order: ['i1', 'i2', 'i3', 'i4'] } },

  // ---------- Databases ----------
  { ref: 'db-3nf', category: 'Databases', type: 'single_choice', difficulty: 'medium', title: 'Transitive dependencies', marks: 2,
    content: { stem: 'Which normal form removes transitive dependencies on the primary key?', options: o('1NF', '2NF', '3NF', 'BCNF is required') },
    key: { correct: 'o3' } },
  { ref: 'db-acid', category: 'Databases', type: 'multiple_choice', difficulty: 'easy', title: 'ACID properties', marks: 4,
    content: { stem: 'Select every property that belongs to **ACID**.', options: o('Atomicity', 'Availability', 'Consistency', 'Isolation', 'Partition tolerance', 'Durability') },
    key: { correct: ['o1', 'o3', 'o4', 'o6'] } },
  { ref: 'db-keys', category: 'Databases', type: 'fill_blanks', difficulty: 'easy', title: 'Primary and foreign keys', marks: 2,
    content: { stem: 'Complete the definitions.', template: 'A [[b1]] key uniquely identifies each row of a table, while a [[b2]] key references a row in another table.', blanks: [{ id: 'b1' }, { id: 'b2' }] },
    key: { blanks: { b1: ['primary'], b2: ['foreign'] }, caseSensitive: false } },
  { ref: 'db-distinct', category: 'Databases', type: 'short_text', difficulty: 'easy', title: 'Removing duplicates in SQL', marks: 2,
    content: { stem: 'Which SQL keyword removes duplicate rows from a query result?', maxLength: 30 },
    key: { accepted: ['DISTINCT', 'SELECT DISTINCT'], caseSensitive: false } },
  { ref: 'db-second-salary', category: 'Databases', type: 'code', difficulty: 'hard', title: 'Second highest salary', marks: 5,
    content: { stem: 'Given `Employees(id, name, salary)`, write a SQL query that returns the **second highest distinct salary**. Return `NULL` when it does not exist.', language: 'sql' },
    key: { sampleAnswer: 'SELECT MAX(salary) FROM Employees WHERE salary < (SELECT MAX(salary) FROM Employees);' },
    rubric: [
      { label: 'Returns the second highest distinct value', points: 3 },
      { label: 'Returns NULL when absent', points: 1 },
      { label: 'Valid, readable SQL', points: 1 },
    ] },
  { ref: 'db-index-essay', category: 'Databases', type: 'long_text', difficulty: 'hard', title: 'B-tree vs hash index', marks: 5,
    content: { stem: 'Compare a **B-tree index** and a **hash index** for (a) equality lookups and (b) range queries. Which would you choose for `WHERE created_at BETWEEN ...` and why?', minWords: 40, maxWords: 300 },
    key: {},
    rubric: [
      { label: 'Both support equality; hash is O(1) average', points: 1 },
      { label: 'Only B-tree supports ordered range scans', points: 2 },
      { label: 'Chooses B-tree for the range predicate with reason', points: 2 },
    ] },

  // ---------- Physics (parameterized, show-your-working) ----------
  { ref: 'phy-accel', category: 'Physics', type: 'numeric', difficulty: 'easy', title: 'Uniform acceleration', marks: 2,
    content: { stem: 'A car accelerates uniformly from rest to {{v}} m/s in {{t}} s. What is its acceleration?', unit: 'm/s²', variables: [{ name: 'v', min: 12, max: 30, step: 2 }, { name: 't', min: 3, max: 8, step: 1 }],
      working: { enabled: true, marks: 2, guidance: 'State the equation you use before substituting values.' } },
    key: { answer: null, formula: 'v / t', tolerance: { type: 'relative', value: 0.01 } },
    rubric: [
      { target: 'working', label: 'Uses a = (v − u) / t', points: 1 },
      { target: 'working', label: 'Correct substitution with units', points: 1 },
    ] },
  { ref: 'phy-freefall', category: 'Physics', type: 'numeric', difficulty: 'hard', title: 'Free-fall impact speed', marks: 3,
    content: { stem: 'An object is dropped from rest from a height of {{h}} m. Ignoring air resistance and taking $g = 9.8\\ \\text{m/s}^2$, what is its speed just before it hits the ground?', unit: 'm/s', variables: [{ name: 'h', min: 5, max: 45, step: 5 }],
      working: { enabled: true, marks: 2 } },
    key: { answer: null, formula: 'sqrt(2 * 9.8 * h)', tolerance: { type: 'relative', value: 0.02 } },
    rubric: [
      { target: 'working', label: 'Uses v² = u² + 2gh (or energy conservation)', points: 1 },
      { target: 'working', label: 'Takes the square root correctly', points: 1 },
    ] },
  { ref: 'phy-newton', category: 'Physics', type: 'single_choice', difficulty: 'easy', title: "Newton's second law", marks: 2,
    content: { stem: 'A net force of 10 N acts on a 2 kg mass. Its acceleration is:', options: o('0.2 m/s²', '5 m/s²', '12 m/s²', '20 m/s²') },
    key: { correct: 'o2' } },
  { ref: 'phy-units', category: 'Physics', type: 'matching', difficulty: 'easy', title: 'Quantities and SI units', marks: 3,
    content: { stem: 'Match each quantity with its SI unit.', prompts: o('Force', 'Energy', 'Power'), answers: [
      { id: 'a1', text: 'newton (N)' }, { id: 'a2', text: 'joule (J)' }, { id: 'a3', text: 'watt (W)' }, { id: 'a4', text: 'pascal (Pa)' }] },
    key: { pairs: { o1: 'a1', o2: 'a2', o3: 'a3' } } },
  { ref: 'phy-momentum-tf', category: 'Physics', type: 'true_false', difficulty: 'medium', title: 'Momentum in collisions', marks: 2,
    content: { stem: 'In a perfectly inelastic collision, total momentum is conserved but kinetic energy is not.' },
    key: { correct: true } },

  // ---------- Calculus ----------
  { ref: 'calc-derivative', category: 'Calculus', type: 'numeric', difficulty: 'medium', title: 'Derivative at a point', marks: 3,
    content: { stem: 'Let $f(x) = 3x^2 + 2x$. Evaluate $f\'(x)$ at $x = {{a}}$.', variables: [{ name: 'a', min: -5, max: 9, step: 1 }],
      working: { enabled: true, marks: 2 } },
    key: { answer: null, formula: '6 * a + 2', tolerance: { type: 'absolute', value: 0 } },
    rubric: [
      { target: 'working', label: "Differentiates correctly: f'(x) = 6x + 2", points: 1 },
      { target: 'working', label: 'Substitutes the point correctly', points: 1 },
    ] },
  { ref: 'calc-integral', category: 'Calculus', type: 'single_choice', difficulty: 'medium', title: 'Definite integral', marks: 2,
    content: { stem: 'Evaluate $\\displaystyle\\int_0^2 3x^2\\,dx$.', options: o('4', '6', '8', '12') },
    key: { correct: 'o3' } },

  // ---------- Software engineering ----------
  { ref: 'se-patterns', category: 'Software Engineering', type: 'matching', difficulty: 'medium', title: 'Design pattern intents', marks: 4,
    content: { stem: 'Match each design pattern with its intent.', prompts: o('Singleton', 'Observer', 'Strategy', 'Adapter'), answers: [
      { id: 'a1', text: 'Ensure a class has exactly one instance' }, { id: 'a2', text: 'Notify dependents when state changes' }, { id: 'a3', text: 'Swap interchangeable algorithms at runtime' }, { id: 'a4', text: 'Convert one interface into another' }, { id: 'a5', text: 'Build complex objects step by step' }] },
    key: { pairs: { o1: 'a1', o2: 'a2', o3: 'a3', o4: 'a4' } } },
  { ref: 'se-resilience', category: 'Software Engineering', type: 'long_text', difficulty: 'medium', title: 'Designing for unreliable networks', marks: 6,
    content: { stem: 'An online exam must stay fair when a candidate\'s internet connection drops. Describe **two** design techniques that prevent lost answers, and explain how you would stop candidates from gaining extra time.', minWords: 50, maxWords: 350 },
    key: {},
    rubric: [
      { label: 'Local persistence of answers (e.g. IndexedDB journal)', points: 2 },
      { label: 'Idempotent retry / sync on reconnect', points: 2 },
      { label: 'Server-authoritative deadline, not the device clock', points: 2 },
    ] },
];
