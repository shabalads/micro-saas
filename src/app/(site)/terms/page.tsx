import Link from "next/link";
import { COMPANY } from "../../../site/company";
import { CONSENT_STATEMENT, guaranteeLabel, guaranteeSentence } from "../../../site/legal";
import { pageMetadata } from "../../../site/metadata";
import { Fill } from "../../components/site/fill";
import { Callout, LegalPage, List, Section } from "../../components/site/legal-page";
import { FREE_ROW_LIMIT } from "../../utils/pricing";
import { PRICE_LABEL, taxNote } from "../../utils/pricing";

export const metadata = pageMetadata({
  title: "Terms of Service",
  description: `The terms for using ${COMPANY.brandName}: what the service is, prices, delivery of the paid file, your right of withdrawal and how to reach us.`,
  path: "/terms",
});

const link = "underline underline-offset-2 hover:text-emerald-300";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Effective from <Fill value={COMPANY.effectiveDate} />. These terms govern your use of {COMPANY.brandName} (the &ldquo;Service&rdquo;) and any purchase you make through it. Please read them
        together with our <Link href="/privacy" className={link}>Privacy Policy</Link> and <Link href="/refunds" className={link}>Refund Policy</Link>.
      </p>

      <Section title="1. Who we are">
        <p>
          The Service is provided by <Fill value={COMPANY.legalName} />, company ID (IČO) <Fill value={COMPANY.companyId} />, VAT ID (DIČ) <Fill value={COMPANY.vatId} />, with its registered office at{" "}
          <Fill value={COMPANY.street} />, <Fill value={COMPANY.postalCode} /> <Fill value={COMPANY.city} />, {COMPANY.country} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). We are entered in the commercial register: <Fill value={COMPANY.register} />.
          You can reach us at <Fill value={COMPANY.email} />.
        </p>
      </Section>

      <Section title="2. The Service">
        <p>
          {COMPANY.brandName} is a web tool that cleans product CSV files from suppliers so that they can be imported into Shopify. Your file is processed in your own browser. It is not uploaded to our servers.
        </p>
        <List>
          <li>Files with {FREE_ROW_LIMIT} rows or fewer can be cleaned and downloaded for free.</li>
          <li>For larger files, a preview of the first {FREE_ROW_LIMIT} rows is free. The complete cleaned file is available after payment of the price below.</li>
          <li>
            <strong>Your first big file is free.</strong> The first time you load a file with more than {FREE_ROW_LIMIT} rows you can unlock it without payment, once per person. To enforce &ldquo;once per person&rdquo; we process your email address
            (stored only as a keyed hash) and a random browser identifier, as set out in the <Link href="/privacy" className={link}>Privacy Policy</Link>. This is a free offer, not a sale: no price is charged and no
            right of withdrawal arises. We may change or end the offer at any time for future files.
          </li>
        </List>
        <p>
          Functionality and compatibility of the digital content: the cleaned file is a standard CSV file (UTF-8) using Shopify&rsquo;s product column names. The Service needs a current web browser with JavaScript and local
          browser storage enabled. The file is delivered without any technical protection measures (no DRM), and you may use it freely in your own business.
        </p>
      </Section>

      <Section title="3. Price and payment">
        <p>
          The price of the complete cleaned file is <strong>{PRICE_LABEL} (US dollars) per file</strong>, {taxNote()}. The total, including any tax, is shown to you on the payment page before you pay.
        </p>
        <p>
          Payments are processed by Stripe. We never see or store your card details. Stripe sends you a receipt by email. A payment covers the one file it was made for; it is not a subscription and renews nothing.
        </p>
      </Section>

      <Section title="4. Delivery">
        <p>
          The complete file is delivered by download in your browser immediately after your payment is confirmed. If the download is interrupted, you can recover it from the same browser, or on another device with the{" "}
          <Link href="/recover" className={link}>Recover page</Link> by using the email address on your receipt and uploading the same file again.
        </p>
      </Section>

      <Section title="5. Right of withdrawal for consumers">
        <p>
          If you are a consumer, you normally have the right to withdraw from a distance contract within 14 days without giving a reason (Section 1829 of the Czech Civil Code, implementing Directive 2011/83/EU).
        </p>
        <p>
          That right does not apply to the supply of digital content that is not supplied on a tangible medium, where delivery has begun with your prior express consent and you were informed, before the contract was concluded,
          that you lose the right of withdrawal as a result (Section 1837(l) of the Civil Code; Article 16(m) of Directive 2011/83/EU). The complete file is exactly that kind of digital content and is delivered immediately.
        </p>
        <Callout>
          <p>
            Before you can pay, the payment page therefore asks you to confirm: &ldquo;{CONSENT_STATEMENT}&rdquo; If you do not give this confirmation, you cannot purchase the complete file. The free preview and the free
            download of files up to {FREE_ROW_LIMIT} rows are provided without payment and are not affected.
          </p>
        </Callout>
        <p>If you are buying for your business rather than as a consumer, the consumer right of withdrawal does not apply.</p>
        <p>
          <strong>{guaranteeLabel()}.</strong> {guaranteeSentence()} This commercial guarantee is separate from the right of withdrawal above and from your statutory rights, which it does not limit. See the{" "}
          <Link href="/refunds" className={link}>Refund Policy</Link> for how to ask.
        </p>
      </Section>

      <Section title="6. Your statutory rights">
        <p>
          Nothing in these terms limits your rights as a consumer under mandatory law, including the rules on digital content that does not conform to the contract (Directive (EU) 2019/770 as implemented in Czech law). If the
          file cannot be delivered or does not conform, you are entitled to the remedies the law provides. See the <Link href="/refunds" className={link}>Refund Policy</Link> for how to ask.
        </p>
      </Section>

      <Section title="7. Using the Service">
        <List>
          <li>Use the Service only for files you are entitled to process, and not for anything unlawful.</li>
          <li>You are responsible for checking the cleaned file before you import it. We recommend importing a small batch first and keeping a backup of your store data, because a Shopify import can overwrite existing products.</li>
          <li>Do not try to disrupt the Service, to get around the payment for files over {FREE_ROW_LIMIT} rows or the one-free-file-per-person limit (for example with made-up email addresses), or to overload it with automated requests.</li>
        </List>
      </Section>

      <Section title="8. Intellectual property">
        <p>
          The Service, its code and its design belong to us. Your files and the cleaned files made from them remain yours. We do not receive your file contents and claim no rights over them.
        </p>
      </Section>

      <Section title="9. Availability and changes to the Service">
        <p>
          We aim to keep the Service available but do not promise uninterrupted operation. We may improve, change or discontinue features.
        </p>
      </Section>

      <Section title="10. Liability">
        <p>
          We are liable without limit for harm that the law does not allow us to limit, including intent, gross negligence, injury to life or health, and the statutory rights of consumers. Beyond that, for business customers our
          liability is limited to the amount you paid for the file concerned. We cannot guarantee that every cleaned file imports into Shopify without changes, because that also depends on your store and on Shopify.
        </p>
      </Section>

      <Section title="11. Complaints and out-of-court dispute resolution">
        <p>
          Please contact us first at <Fill value={COMPANY.email} />. We aim to reply within {COMPANY.supportReplyTime}. If we cannot resolve a dispute with you as a consumer, you may turn to the out-of-court dispute resolution
          body {COMPANY.adrBody.name}, <a className={link} href={COMPANY.adrBody.website}>{COMPANY.adrBody.website}</a>.
        </p>
      </Section>

      <Section title="12. Governing law">
        <p>
          These terms are governed by Czech law. If you are a consumer living in another EU country, you also keep the protection of the mandatory consumer rules of the country where you live, and you may bring proceedings in
          the courts of that country.
        </p>
      </Section>

      <Section title="13. Changes to these terms">
        <p>We may update these terms. The version in force when you buy applies to your purchase. The effective date is shown at the top of this page.</p>
      </Section>
    </LegalPage>
  );
}
