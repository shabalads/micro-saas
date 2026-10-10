import Link from "next/link";
import { COMPANY } from "../../../site/company";
import { pageMetadata } from "../../../site/metadata";
import { Fill } from "../../components/site/fill";
import { Callout, LegalPage, List, Section } from "../../components/site/legal-page";
import { FREE_ROW_LIMIT } from "../../utils/pricing";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description: `How ${COMPANY.brandName} handles personal data: your files stay in your browser, what anonymous statistics we keep, what we store for the free first file and for purchases, and your GDPR rights.`,
  path: "/privacy",
});

const link = "underline underline-offset-2 hover:text-emerald-300";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Effective from <Fill value={COMPANY.effectiveDate} />. This policy explains what personal data we process when you use {COMPANY.brandName}, why, and what your rights are under the General Data Protection Regulation (GDPR).
      </p>

      <Callout>
        <p>
          <strong>The short version:</strong> the CSV files you clean are processed inside your own browser and are never sent to us. We keep anonymous usage counts; if you buy, the payment details Stripe passes on to us; and if you claim your
          free first big file, a one-way hash of your email address and a random id of your browser (your email address itself only if you tick the optional box for product updates). We use no advertising or analytics cookies.
        </p>
      </Callout>

      <Section title="1. Who is responsible for your data">
        <p>
          The controller is <Fill value={COMPANY.legalName} />, company ID (IČO) <Fill value={COMPANY.companyId} />, registered office <Fill value={COMPANY.street} />, <Fill value={COMPANY.postalCode} />{" "}
          <Fill value={COMPANY.city} />, {COMPANY.country}. Contact for any privacy question or request: <Fill value={COMPANY.email} />.
        </p>
      </Section>

      <Section title="2. What we process, why, and on what legal basis">
        <p className="font-semibold text-neutral-100">Your files: not processed by us</p>
        <p>
          The contents of the files you open (product titles, descriptions, prices, SKUs and so on) are read and cleaned in your browser. They are not uploaded to or received by our servers, so we do not process them as a controller or
          processor.
        </p>

        <p className="pt-2 font-semibold text-neutral-100">Anonymous usage statistics</p>
        <p>
          Each time you clean a file we record: the number of rows, the file size, how long cleaning took, how many fixes were made, and a one-way hash of the file name. We never record file contents or the file name itself. On
          their own these figures do not identify you. For a file you pay for, its statistics are linked to your purchase record through an internal ID, so that we can tell which file a payment was for. Purpose: running and improving the Service and spotting abuse. Legal basis: our legitimate interest (Art. 6(1)(f) GDPR). We keep them for{" "}
          <Fill value={COMPANY.telemetryRetention} />. These statistics never contain your email address, and they are not linked to the record of a free first file (below): that record holds a hash of the file&rsquo;s content, not of its name, and
          nothing joins the two.
        </p>

        <p className="pt-2 font-semibold text-neutral-100">Purchases</p>
        <p>
          When you buy the complete file, Stripe collects your payment details, billing address and email address on its payment page. We store only: the email address on your receipt, the Stripe session ID, the time of payment,
          and a fingerprint (a hash) of the file the payment is for, which lets us unlock exactly that file for you again. Stripe&rsquo;s payment notifications to us also contain your billing details; we do not keep them. Purpose: completing the contract, delivering the file, helping you recover it, support and refunds. Legal
          basis: performance of a contract (Art. 6(1)(b)), and compliance with accounting and tax law (Art. 6(1)(c)). We keep purchase records for as long as that law requires (in the Czech Republic generally up to 10 years).
        </p>

        <p className="pt-2 font-semibold text-neutral-100">Your free first big file</p>
        <p>
          Your first file with more than {FREE_ROW_LIMIT} rows can be unlocked without payment, once per person. To claim it you enter your email address. We do not store the address: we compute a keyed one-way hash of it (HMAC-SHA256 with a
          secret key that only our server holds), so the address cannot be read back from the hash. Together with the time and a fingerprint of the file (a hash of its content, not the file), we store the hash and a random identifier of your browser, which is also kept in
          your browser (see section 3). That is all the record contains. Purpose: giving one free file per person, preventing repeated use, and letting you download the same file again. Legal basis: our legitimate interest in running the offer fairly
          (Art. 6(1)(f) GDPR) and, for the free file itself, taking steps at your request. We keep this record for <Fill value={COMPANY.trialRetention} />, then delete it.
        </p>
        <p>
          <strong>Product updates are optional.</strong> The box for occasional product updates is separate and unticked by default, and the free file does not depend on it. Only if you tick it do we store your email address itself, with the time you agreed,
          so that we can send you updates. Legal basis: your consent (Art. 6(1)(a) GDPR). You can withdraw it at any time by writing to <Fill value={COMPANY.email} />, and we then delete the address; we keep it only until you do.
        </p>

        <p className="pt-2 font-semibold text-neutral-100">Support requests</p>
        <p>
          If you email us, we process your email address and what you tell us in order to answer you (legitimate interest and, for purchases, contract). We keep the correspondence as long as needed to deal with the matter and any
          follow-up.
        </p>

        <p className="pt-2 font-semibold text-neutral-100">Server logs</p>
        <p>
          Our hosting provider, <Fill value={COMPANY.hostingProvider} />, keeps technical logs of requests (such as IP address, time and the page requested) for security and reliability. Legal basis: legitimate interest. Retention is
          set by the provider and is short.
        </p>
      </Section>

      <Section title="3. Storage in your browser, and cookies">
        <p>The Service stores a little data on your own device so that it works. We never receive it:</p>
        <List>
          <li>
            <strong>Your file during checkout.</strong> If you start a purchase, a copy of your file is kept in your browser&rsquo;s IndexedDB so it is still there when you return from the payment page. It is removed after your
            download has been delivered, and an unpaid copy is removed when you next visit once it is 48 hours old. You can also clear it any time in your browser&rsquo;s site data settings.
          </li>
          <li>
            <strong>Your payments and free file on this device.</strong> The Stripe session ID (or free-file reference) and file fingerprint of purchases you have made or recovered, so that uploading the same file again unlocks it.
          </li>
          <li>
            <strong>A random browser id, only if you claim the free first big file.</strong> It is kept in your browser&rsquo;s localStorage and in a cookie named <code>csv_trial_browser</code>, which is set only when you claim the free file and is read for nothing
            else. Together they let us give one free file per browser and recognise your browser when you download the same file again. The id is random and contains no personal data. Clearing your browser&rsquo;s site data removes it.
          </li>
        </List>
        <p>
          This storage is strictly necessary to provide the feature you ask for, so it does not need a consent banner. We do not use advertising, tracking or analytics cookies. (Stripe&rsquo;s payment page, which Stripe operates, uses its
          own cookies under Stripe&rsquo;s policy.)
        </p>
      </Section>

      <Section title="4. Who receives data">
        <List>
          <li>
            <strong>Stripe</strong> (payment processing, tax calculation and receipts). Stripe acts as an independent controller for payment and fraud-prevention data and under its own privacy policy.
          </li>
          <li>
            <strong><Fill value={COMPANY.databaseProvider} /></strong>, which hosts our database (usage statistics, purchase records and the free-first-file records), as our processor.
          </li>
          <li>
            <strong><Fill value={COMPANY.hostingProvider} /></strong>, which hosts the website, as our processor.
          </li>
          <li>Our accountant and authorities, where the law requires us to disclose purchase records.</li>
        </List>
        <p>We do not sell personal data and do not use it for advertising.</p>
      </Section>

      <Section title="5. Transfers outside the EU/EEA">
        <p>
          Some of these providers may process data outside the EU/EEA (for example in the United States). Where they do, the transfer relies on safeguards such as the EU Standard Contractual Clauses or an adequacy decision such as
          the EU-US Data Privacy Framework.
        </p>
      </Section>

      <Section title="6. Your rights">
        <p>Under the GDPR you have the right to:</p>
        <List>
          <li>access the personal data we hold about you and receive a copy;</li>
          <li>have inaccurate data corrected and, in many cases, have it erased;</li>
          <li>restrict our processing, and object to processing based on legitimate interest;</li>
          <li>receive data you gave us in a portable format, where the processing is based on contract;</li>
          <li>complain to a supervisory authority.</li>
        </List>
        <p>
          To use any of these rights, write to <Fill value={COMPANY.email} />. We answer within one month. Usage statistics from files you did not pay for are anonymous and cannot be traced to you, so we cannot look them up. Purchase records, and the
          statistics linked to them, can be found with your receipt email. A free-first-file record can be found only if you give us the email address it was claimed with (we compare its hash), and we can then delete it, or the optional product-updates address.
        </p>
        <p>
          You may complain to the Czech supervisory authority, {COMPANY.dataProtectionAuthority.name}, <a className={link} href={COMPANY.dataProtectionAuthority.website}>{COMPANY.dataProtectionAuthority.website}</a>, or to the
          authority in the EU country where you live or work.
        </p>
      </Section>

      <Section title="7. Other points">
        <List>
          <li>We do not make decisions about you by automated means that have legal or similarly significant effects.</li>
          <li>The Service is not directed at children.</li>
          <li>Data is protected in transit (HTTPS), access to the database is restricted to the server, and payment card data never reaches us.</li>
          <li>
            We may update this policy; the effective date is shown above. See also our <Link href="/terms" className={link}>Terms of Service</Link>.
          </li>
        </List>
      </Section>
    </LegalPage>
  );
}
