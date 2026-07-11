import { ExternalLink, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createConnectOnboarding,
  billingPresentationEnabled,
  loadBillingConfig,
  loadBillingStatus,
  requestSellerPayout,
  type BillingConfig,
  type BillingStatus,
} from '../lib/billingClient'

const MIN_PAYOUT_CREDITS = 250

export function SellerPayoutPanel() {
  const [config, setConfig] = useState<BillingConfig | null>(null)
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [credits, setCredits] = useState(MIN_PAYOUT_CREDITS)
  const [pending, setPending] = useState<'loading' | 'onboarding' | 'payout' | null>(billingPresentationEnabled ? 'loading' : null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    const [configResult, statusResult] = await Promise.all([loadBillingConfig(), loadBillingStatus()])
    if (configResult.ok) setConfig(configResult.data)
    if (statusResult.ok) setStatus(statusResult.data)
    if (!configResult.ok) setError(configResult.message)
    else if (!statusResult.ok) setError(statusResult.message)
    setPending(null)
  }

  useEffect(() => {
    if (billingPresentationEnabled) void refresh()
  }, [])

  const onboarding = async () => {
    setPending('onboarding')
    setError('')
    const result = await createConnectOnboarding()
    if (!result.ok) {
      setError(result.message)
      setPending(null)
      return
    }
    window.location.assign(result.data.url)
  }

  const payout = async () => {
    if (!Number.isInteger(credits) || credits < MIN_PAYOUT_CREDITS) {
      setError(`Il payout minimo è ${MIN_PAYOUT_CREDITS} crediti convertibili (€25).`)
      return
    }
    setPending('payout')
    setError('')
    const result = await requestSellerPayout(credits)
    if (!result.ok) {
      setError(result.message)
      setPending(null)
      return
    }
    setMessage(`Richiesta ${result.data.status}: riferimento ${result.data.requestId.slice(0, 8)}.`)
    await refresh()
  }

  const convertible = status?.wallet?.earnedConvertible ?? 0
  const account = status?.connectedAccount
  const connectReady = Boolean(config?.enabled && config.connectEnabled)

  return (
    <article className="settings-credit-card settings-payout-card">
      <span className="settings-credit-label"><Wallet size={16} /> Incassi venditore</span>
      <p>Solo ricavi cash-backed, dopo hold e rettifiche, possono essere trasferiti tramite Stripe Connect.</p>
      <div className="settings-payout-balance">
        <span>Convertibili</span>
        <strong>{convertible} cr</strong>
        <small>≈ €{(convertible / 10).toFixed(2)}</small>
      </div>

      {pending === 'loading' ? (
        <span className="settings-profile-message"><Loader2 className="spin" size={15} /> Verifico Connect…</span>
      ) : !connectReady ? (
        <small>Connect resta disabilitato finché configurazione commerciale, KYC e Stripe non sono completi.</small>
      ) : !account?.payoutsEnabled ? (
        <button className="secondary-action" disabled={pending !== null} onClick={() => void onboarding()} type="button">
          {pending === 'onboarding' ? <Loader2 className="spin" size={15} /> : <ExternalLink size={15} />}{' '}
          {account && !account.termsCurrent ? 'Aggiorna condizioni venditore' : 'Completa verifica Stripe'}
        </button>
      ) : (
        <>
          <label className="settings-payout-input">
            <span>Crediti da prelevare</span>
            <input min={MIN_PAYOUT_CREDITS} max={convertible} step={10} type="number" value={credits} onChange={(event) => setCredits(Number(event.target.value))} />
          </label>
          <button className="secondary-action" disabled={pending !== null || credits > convertible} onClick={() => void payout()} type="button">
            {pending === 'payout' ? <Loader2 className="spin" size={15} /> : <Wallet size={15} />} Richiedi payout
          </button>
        </>
      )}
      <button className="settings-payout-refresh" disabled={!billingPresentationEnabled || pending !== null} onClick={() => { setPending('loading'); void refresh() }} type="button">
        <RefreshCw size={13} /> Aggiorna stato
      </button>
      {message ? <span className="settings-profile-message">{message}</span> : null}
      {error ? <span className="settings-profile-message error" role="alert">{error}</span> : null}
    </article>
  )
}
