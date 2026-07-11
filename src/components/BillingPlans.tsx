import { Check, Crown, Loader2, ShieldCheck, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AppAuthUser } from '../lib/supabaseClient'
import {
  billingCanBePresented,
  billingPresentationEnabled,
  createBillingCheckout,
  createBillingPortal,
  loadBillingConfig,
  loadBillingStatus,
  type BillingConfig,
  type BillingStatus,
} from '../lib/billingClient'
import { TOPUP_PACKS } from '../lib/creditPricing'
import type { LegalRoute } from '../legalContent'

const LAST_CHECKOUT_KEY = 'unimidoc:last-checkout-request'

function formatMoney(amountMinor: number, currency = 'eur') {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: currency.toUpperCase() }).format(amountMinor / 100)
}

export function BillingPlans({
  user,
  onLogin,
  onLegal,
  onBillingUpdated,
}: {
  user: AppAuthUser | null
  onLogin: () => void
  onLegal: (route: LegalRoute) => void
  onBillingUpdated: () => void
}) {
  const [config, setConfig] = useState<BillingConfig | null>(null)
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(billingPresentationEnabled)
  const [pending, setPending] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!billingPresentationEnabled) {
      setLoading(false)
      return
    }
    let active = true
    void loadBillingConfig().then((result) => {
      if (!active) return
      if (result.ok) setConfig(result.data)
      else setError(result.message)
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!user || user.isDemo || !billingPresentationEnabled) return
    let active = true
    void loadBillingStatus().then((result) => {
      if (active && result.ok) setStatus(result.data)
    })
    return () => { active = false }
  }, [user])

  useEffect(() => {
    if (!user || user.isDemo) return
    const search = new URLSearchParams(window.location.search)
    const checkoutResult = search.get('billing') ?? search.get('checkout')
    if (checkoutResult === 'cancelled') {
      setMessage('Checkout annullato: non è stato effettuato alcun addebito.')
      return
    }
    if (checkoutResult !== 'success') return
    const checkoutRequestId = window.sessionStorage.getItem(LAST_CHECKOUT_KEY) ?? undefined
    let active = true
    let attempts = 0
    const poll = async () => {
      attempts += 1
      const result = await loadBillingStatus(checkoutRequestId)
      if (!active) return
      if (!result.ok) {
        setError(result.message)
        return
      }
      setStatus(result.data)
      const checkoutStatus = result.data.checkout?.status
      if (checkoutStatus === 'paid') {
        setMessage('Pagamento confermato dal webhook: saldo e accesso sono stati aggiornati.')
        window.sessionStorage.removeItem(LAST_CHECKOUT_KEY)
        onBillingUpdated()
        return
      }
      if (checkoutStatus === 'failed' || checkoutStatus === 'expired' || checkoutStatus === 'refunded') {
        setError('Il pagamento non risulta completato. Il saldo non è stato modificato.')
        return
      }
      if (attempts < 8) window.setTimeout(() => void poll(), 1500)
      else setMessage('Pagamento ricevuto e ancora in verifica. Aggiorna tra pochi istanti: nessun credito viene perso.')
    }
    void poll()
    return () => { active = false }
  }, [onBillingUpdated, user])

  const subscriptionOffer = useMemo(
    () => config?.offers.find((offer) => offer.kind === 'subscription') ?? null,
    [config],
  )
  const topupOffers = useMemo(
    () => config?.offers.filter((offer) => offer.kind === 'topup') ?? [],
    [config],
  )
  const checkoutReady = Boolean(billingCanBePresented() && config?.enabled && config.legalReady)

  const startCheckout = async (offerKey: string) => {
    setError('')
    setMessage('')
    if (!user || user.isDemo) {
      onLogin()
      return
    }
    if (!accepted) {
      setError('Prima del pagamento conferma Termini e condizioni di vendita.')
      return
    }
    if (!checkoutReady) {
      setError('Checkout non ancora disponibile: configurazione legale o server incompleta.')
      return
    }
    setPending(offerKey)
    const result = await createBillingCheckout(offerKey)
    if (!result.ok) {
      setError(result.message)
      setPending(null)
      return
    }
    window.sessionStorage.setItem(LAST_CHECKOUT_KEY, result.data.checkoutRequestId)
    window.location.assign(result.data.url)
  }

  const openPortal = async () => {
    setError('')
    setPending('portal')
    const result = await createBillingPortal()
    if (!result.ok) {
      setError(result.message)
      setPending(null)
      return
    }
    window.location.assign(result.data.url)
  }

  const disabledReason = !billingPresentationEnabled
    ? 'Billing disabilitato nell’ambiente corrente.'
    : loading
      ? 'Verifica configurazione pagamenti…'
      : !config?.enabled
        ? 'Provider pagamenti non ancora attivato.'
        : !config.legalReady
          ? 'Dati legali non ancora completi.'
          : ''

  return (
    <>
      <div className="billing-runtime-state" role="status">
        {loading ? <Loader2 className="spin" size={17} /> : checkoutReady ? <ShieldCheck size={17} /> : <Wallet size={17} />}
        <span>
          <strong>{checkoutReady ? `Checkout Stripe ${config?.mode === 'live' ? 'live' : 'test'} disponibile` : 'Monetizzazione protetta'}</strong>
          {disabledReason || 'Importi e crediti arrivano dal catalogo server; l’accredito avviene soltanto dopo webhook firmato.'}
        </span>
      </div>

      <div className="premium-plan-grid">
        <article className="premium-plan highlight">
          <span className="premium-plan-tag"><Crown size={14} /> Premium</span>
          <strong className="premium-plan-price">
            {subscriptionOffer ? formatMoney(subscriptionOffer.amountMinor, subscriptionOffer.currency) : '€4,99'}
            <span>/{subscriptionOffer?.interval === 'year' ? 'anno' : 'mese'}</span>
          </strong>
          <ul>
            <li><Check size={15} /> Anteprime complete</li>
            <li><Check size={15} /> Flashcard, quiz e image occlusion</li>
            <li><Check size={15} /> Ricerca avanzata + download senza attese</li>
            <li><Check size={15} /> Disdetta dal portale cliente</li>
          </ul>
          {status?.subscription ? (
            <button className="premium-button" disabled={pending !== null} onClick={() => void openPortal()} type="button">
              {pending === 'portal' ? <Loader2 className="spin" size={17} /> : <Crown size={17} />} Gestisci abbonamento
            </button>
          ) : (
            <button
              className="premium-button"
              disabled={pending !== null || (Boolean(user) && !checkoutReady)}
              onClick={() => void startCheckout(subscriptionOffer?.key ?? 'premium_monthly')}
              type="button"
            >
              {pending === (subscriptionOffer?.key ?? 'premium_monthly') ? <Loader2 className="spin" size={17} /> : <Crown size={17} />}
              {user ? 'Passa a Premium' : 'Accedi per continuare'}
            </button>
          )}
        </article>

        <article className="premium-plan">
          <span className="premium-plan-tag"><Wallet size={14} /> Crediti</span>
          <strong className="premium-plan-price">da €5</strong>
          <p className="premium-plan-note">La parte bonus è promozionale e resta distinta dai crediti coperti dal pagamento.</p>
          <ul className="premium-pack-list billing-pack-list">
            {(topupOffers.length ? topupOffers : TOPUP_PACKS.map((pack) => ({
              key: `topup_${pack.id}`,
              kind: 'topup' as const,
              name: pack.id,
              amountMinor: pack.priceEur * 100,
              currency: 'eur',
              paidCredits: pack.paidCredits,
              promotionalCredits: pack.promotionalCredits,
              totalCredits: pack.totalCredits,
            }))).map((offer) => (
              <li key={offer.key}>
                <span>{formatMoney(offer.amountMinor, offer.currency)}</span>
                <strong>{offer.totalCredits} crediti</strong>
                <em>{offer.promotionalCredits > 0 ? `+${offer.promotionalCredits} bonus` : 'base'}</em>
                <button
                  aria-label={`Acquista ${offer.totalCredits} crediti`}
                  disabled={pending !== null || (Boolean(user) && !checkoutReady)}
                  onClick={() => void startCheckout(offer.key)}
                  type="button"
                >
                  {pending === offer.key ? <Loader2 className="spin" size={14} /> : 'Scegli'}
                </button>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <label className="billing-legal-consent">
        <input checked={accepted} onChange={(event) => setAccepted(event.target.checked)} type="checkbox" />
        <span>
          Ho letto e accetto i <button onClick={() => onLegal('terms')} type="button">Termini</button> e le{' '}
          <button onClick={() => onLegal('sales')} type="button">condizioni di vendita, recesso e rimborso</button>.
        </span>
      </label>
      {message ? <p className="billing-message" role="status">{message}</p> : null}
      {error ? <p className="billing-error" role="alert">{error}</p> : null}
    </>
  )
}
