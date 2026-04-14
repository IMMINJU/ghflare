// --- GitHub Trending ---

export type TrendingRepo = {
  owner: string
  name: string
  description: string
  language: string | null
  stars: number
}

// --- Raw GitHub API ---

export type RawIssue = {
  id: number
  number: number
  title: string
  body: string | null
  created_at: string   // ISO 8601
  labels: string[]
}

// --- Anomaly Detection ---

export type AnomalyLevel = 'normal' | 'elevated' | 'spike'

export type AnomalyResult = {
  score: number        // ratio - 1 (0 = baseline)
  level: AnomalyLevel
  multiplier: number   // e.g. 6.0 = 6x usual activity
}

// --- Clustering ---

export type Cluster = {
  label: string
  issueIds: number[]
  centroid: number[]
}

// --- DB Rows ---

export type RepoRow = {
  id: number
  owner: string
  name: string
  description: string | null
  language: string | null
  stars: number
  created_at: string
  updated_at: string
}

export type IssueRow = {
  id: number
  repo_id: number
  issue_number: number
  title: string
  body: string | null
  labels: string[]
  embedding: number[] | null
  created_at: string
  indexed_at: string
}

export type SnapshotRow = {
  id: number
  repo_id: number
  date: string         // YYYY-MM-DD
  issue_count: number
  anomaly_score: number | null
  anomaly_level: AnomalyLevel | null
  created_at: string
}

export type ClusterRow = {
  id: number
  repo_id: number
  label: string
  centroid: number[] | null
  created_at: string
}

// --- API Response Types ---

export type AnomalousRepo = {
  owner: string
  name: string
  description: string
  stars: number
  language: string | null
  detectedAt: string | null
  anomaly: {
    level: AnomalyLevel
    score: number
    recentCount: number
    historicalAvg: number
    multiplier: number
  }
  topTopics: string[]
}

export type TrendingResponse = {
  repos: AnomalousRepo[]
  updatedAt: string
}

export type TimelinePoint = {
  date: string         // YYYY-MM-DD
  count: number
  isAnomalous: boolean
}

export type ClusterDetail = {
  id: string
  label: string
  count: number
  issues: {
    number: number
    title: string
    url: string
    createdAt: string
  }[]
}

export type RepoDetailResponse = {
  repo: {
    owner: string
    name: string
    description: string
    stars: number
  }
  anomaly: {
    level: AnomalyLevel
    score: number
    recentCount: number
    historicalAvg: number
    multiplier: number
  }
  timeline: TimelinePoint[]
  clusters: ClusterDetail[]
}

export type ErrorResponse = {
  error: string
  code: string
}

// --- Pipeline ---

export type PipelineRunRequest = {
  force?: boolean
}

export type PipelineRunResponse = {
  success: boolean
  reposProcessed: number
  issuesCollected: number
  newEmbeddings: number
  errors: number
  duration: number
}
