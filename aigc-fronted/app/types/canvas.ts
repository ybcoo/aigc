export type NodeKind = 'character' | 'scene' | 'prop' | 'text' | 'image' | 'audio' | 'shot' | 'video' | 'script'

export interface Episode {
  id: string
  episodeNumber: number
  title: string
  scriptContent?: string
}

export interface Project {
  id: string
  title: string
  description: string
  genre?: string
  style?: string
  textModelId?: string
  aspectRatio: string
  episodeCount: number
  episodes: Episode[]
  updatedAt: string
}

export interface ScriptImportPreview {
  title: string
  encoding: string
  chapterCount: number
  characterCount: number
  chapters: Array<{ episodeNumber: number, title: string, characterCount: number }>
}
export interface ScriptImportSettings { title?: string, encoding?: string, textModelId?: string, aspectRatio?: string, genre?: string, style?: string }

export interface AssetNode {
  id: string
  kind: 'character' | 'scene' | 'prop'
  name: string
  description: string
  appearance: string
  prompt: string
  imageUrl: string
  aspectRatio: string
}

export interface TextNode {
  id: string
  title: string
  content: string
  prompt: string
}

export interface ImageNode {
  id: string
  name: string
  imageUrl: string
  prompt: string
  aspectRatio: string
}

export interface AudioNode {
  id: string
  name: string
  audioUrl: string
  duration: number
}

export interface ShotNode {
  id: string
  title: string
  description: string
  sourceScript: string
  storyboardScript: string
  universalPrompt: string
  dialogue: string
  shotType: string
  movement: string
  aspectRatio: string
  duration: number
  videoResolution: string
  imageUrl: string
  lastImageUrl: string
  videoUrl: string
  canvasVideoNode: boolean
}

export interface CanvasLink {
  id: string
  sourceKind: string
  sourceId: string
  targetKind: string
  targetId: string
  locked: boolean
}

export interface CanvasLayout {
  nodeId: string
  x: number
  y: number
  width?: number
  height?: number
}

export interface CanvasPayload {
  project: Project
  episodeNumber: number
  assets: AssetNode[]
  textNodes: TextNode[]
  referenceNodes: ImageNode[]
  audioNodes: AudioNode[]
  shots: ShotNode[]
  links: CanvasLink[]
  layouts: CanvasLayout[]
  jobs: CanvasJob[]
  contexts?: Record<string, { references: CanvasReference[], textPrompt: string }>
}

export interface CanvasReference { id: string, sourceKey: string, kind: 'image' | 'video' | 'audio', token: string, name: string, url: string }
export interface CanvasJob {
  id: string
  targetId: string
  status: string
  error: string
  kind: string
  episodeNumber: number
  progress?: number
  createdAt?: string
  updatedAt?: string
  references?: CanvasReference[]
  input?: Partial<CanvasGenerationInput> & { nodeKind?: string, nodeTitle?: string, configName?: string, model?: string, providerPrompt?: string, outputFormat?: 'mp4' | 'mp3', category?: 'character' | 'scene' | 'prop', genre?: string, style?: string }
  result?: { url?: string, content?: string, created?: number, reused?: number, assetIds?: string[] }
}
export interface CanvasGenerationInput { prompt: string, modelId?: string, aspectRatio: string, duration?: number, resolution?: string, episodeNumber?: number }

export type CanvasRecord = AssetNode | TextNode | ImageNode | AudioNode | ShotNode

export interface CanvasMediaVersion {
  id: string
  kind: 'image' | 'video' | 'audio'
  url: string
  source: string
  aspectRatio: string
  isCurrent: boolean
  createdAt: string
}

export interface MediaHistoryTarget {
  kind: NodeKind
  id: string
  title: string
}

export interface NodeSaveInput {
  episodeNumber?: number
  name?: string
  title?: string
  description?: string
  appearance?: string
  prompt?: string
  content?: string
  sourceScript?: string
  storyboardScript?: string
  universalPrompt?: string
  dialogue?: string
  shotType?: string
  movement?: string
  aspectRatio?: string
  duration?: number
  videoResolution?: string
  imageUrl?: string
  audioUrl?: string
  videoUrl?: string
  assetIds?: string[]
}
