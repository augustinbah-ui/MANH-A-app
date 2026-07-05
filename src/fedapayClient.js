// Configuration FedaPay — la clé publique seule est utilisée côté navigateur.
// La clé secrète ne doit JAMAIS apparaître dans ce fichier ni dans aucun fichier
// envoyé au navigateur : elle reste uniquement dans le tableau de bord FedaPay.

export const FEDAPAY_PUBLIC_KEY = import.meta.env.VITE_FEDAPAY_PUBLIC_KEY;

export const FEDAPAY_ENVIRONMENT = import.meta.env.VITE_FEDAPAY_ENV || "live";

/**
 * Ouvre le widget de paiement FedaPay et retourne une Promise qui se résout
 * avec le résultat de la transaction.
 *
 * @param {Object} params
 * @param {number} params.amount - Montant en FCFA
 * @param {string} params.description - Description affichée au client
 * @param {Object} params.customer - { firstname, lastname, email, phone_number }
 * @returns {Promise<{success: boolean, transaction: any}>}
 */
export function openFedaPayCheckout({ amount, description, customer }) {
  return new Promise((resolve, reject) => {
    const FedaPay = window["FedaPay"];
    if (!FedaPay) {
      reject(new Error("FedaPay Checkout.js n'a pas pu se charger."));
      return;
    }
    try {
      FedaPay.init({
        public_key: FEDAPAY_PUBLIC_KEY,
        transaction: {
          amount: Math.round(amount),
          description,
        },
        customer: {
          firstname: customer.firstname || "Client",
          lastname: customer.lastname || "Manhïa",
          email: customer.email || "client@manhia.app",
          phone_number: customer.phone_number,
        },
        currency: { iso: "XOF" },
        onComplete: (resp) => {
          if (resp.reason === FedaPay.CHECKOUT_COMPLETE) {
            resolve({ success: true, transaction: resp.transaction });
          } else {
            resolve({ success: false, transaction: resp.transaction || null });
          }
        },
      }).open();
    } catch (e) {
      reject(e);
    }
  });
}

