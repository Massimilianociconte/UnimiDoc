import { callBackendFunction, type AiClientResult } from './aiClient'

export type PrivacyRequest = {
  id: string
  request_type: string
  status: string
  public_message: string | null
  legal_hold: boolean
  requested_at: string
  updated_at: string
  cancelled_at?: string | null
  completed_at?: string | null
}

export function loadPrivacyRequests(): Promise<AiClientResult<{ requests: PrivacyRequest[] }>> {
  return callBackendFunction('privacy-center', { action: 'status' })
}

export function exportAccountData(): Promise<AiClientResult<{ export: unknown; manifestSha256: string }>> {
  return callBackendFunction('privacy-center', { action: 'export' })
}

export function requestAccountErasure(): Promise<AiClientResult<{ request: PrivacyRequest; idempotent: boolean }>> {
  return callBackendFunction('privacy-center', { action: 'request_erasure' })
}

export function cancelAccountErasure(requestId: string): Promise<AiClientResult<{ request: PrivacyRequest }>> {
  return callBackendFunction('privacy-center', { action: 'cancel_erasure', requestId })
}
