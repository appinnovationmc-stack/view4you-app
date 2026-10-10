// Sends the browser/WebView to PayFast's hosted payment page by POSTing the server-signed fields.
// PayFast has no JSON API for this: the checkout page itself must receive the form.
import type { PayfastCheckout } from './data'

export function redirectToPayFast(payment: Pick<PayfastCheckout, 'action' | 'fields'>) {
  if (!/^https:\/\/(www|sandbox)\.payfast\.co\.za\//.test(payment.action)) throw new Error('Unexpected payment address')
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = payment.action
  form.style.display = 'none'
  for (const [name, value] of Object.entries(payment.fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}
