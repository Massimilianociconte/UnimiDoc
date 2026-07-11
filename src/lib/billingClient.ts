import { callBackendFunction, callPublicBackendFunction, type AiClientResult } from './aiClient'
import { LEGAL_VERSION, isLegalOperatorConfigured } from '../legalContent'

export type BillingOffer = {
  key: string
  kind: 'topup' | 'subscription'
  name: string
  amountMinor: number
  currency: string
  paidCredits: number
  promotionalCredits: number
  totalCredits: number
  interval?: 'month' | 'year' | null
}

export type BillingConfig = {
  enabled: boolean
  mode: 'test' | 'live' | 'disabled'
  legalReady: boolean
  offers: BillingOffer[]
  connectEnabled: boolean
}

export type BillingStatus = {
  checkout?: {
    id: string
    status: 'reserved' | 'open' | 'processing' | 'paid' | 'expired' | 'failed' | 'refunded'
    offerKey: string
  } | null
  subscription?: {
    status: string
    currentPeriodEnd?: string | null
    cancelAtPeriodEnd?: boolean
  } | null
  wallet?: {
    balance: number
    freeCredits: number
    promotionalCredits: number
    purchasedCredits: number
    earnedCredits: number
    earnedConvertible: number
  } | null
  connectedAccount?: {
    status: string
    payoutsStatus: string
    payoutsEnabled: boolean
    termsCurrent: boolean
  } | null
}

export const billingPresentationEnabled = import.meta.env.VITE_BILLING_ENABLED === 'true'

export function billingCanBePresented(): boolean {
  return billingPresentationEnabled && isLegalOperatorConfigured
}

export function loadBillingConfig(): Promise<AiClientResult<BillingConfig>> {
  return callPublicBackendFunction<BillingConfig>('billing-config', {})
}

export function createBillingCheckout(offerKey: string): Promise<AiClientResult<{ url: string; checkoutRequestId: string }>> {
  const requestId = crypto.randomUUID()
  return callBackendFunction('billing-checkout', {
    offerKey,
    requestId,
    acceptedTermsVersion: LEGAL_VERSION,
    acceptedSalesVersion: LEGAL_VERSION,
  })
}

export function loadBillingStatus(checkoutRequestId?: string): Promise<AiClientResult<BillingStatus>> {
  return callBackendFunction<BillingStatus>('billing-status', checkoutRequestId ? { checkoutRequestId } : {})
}

export function createBillingPortal(): Promise<AiClientResult<{ url: string }>> {
  return callBackendFunction('billing-portal', {})
}

export function createConnectOnboarding(): Promise<AiClientResult<{ url: string; status?: string }>> {
  return callBackendFunction('connect-onboarding', { acceptedConnectTermsVersion: LEGAL_VERSION })
}

export function requestSellerPayout(credits: number): Promise<AiClientResult<{ requestId: string; status: string }>> {
  return callBackendFunction('payout-request', { credits, requestId: crypto.randomUUID() })
}
