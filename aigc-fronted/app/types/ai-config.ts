export type AIServiceType = 'text' | 'vision' | 'image' | 'storyboard_image' | 'video' | 'tts'

export interface AIConfigInput {
  serviceType: AIServiceType
  provider: string
  apiProtocol: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  defaultModel: string
  endpoint: string
  queryEndpoint: string
  priority: number
  isDefault: boolean
  isActive: boolean
  runtimeParams: Record<string, string>
}

export interface AIConfig extends Omit<AIConfigInput, 'apiKey'> {
  id: string
  apiKeyMasked: string
  createdAt: string
  updatedAt: string
}

export interface AIConfigTestResult {
  success: boolean
  response: string
  errorMessage: string
}
