import Link from "next/link";
import { COMPANY, isPlaceholder } from "../../../site/company";
import { pageMetadata } from "../../../site/metadata";
import { Fill } from "../../components/site/fill";
import { LegalPage, Section } from "../../components/site/legal-page";

export const metadata = pageMetadata({
  title: "Contact",
  description: `Get in touch with ${COMPANY.brandName}: support email, company details and how to reach us about payments, refunds and privacy.`,
  path: "/contact",
});

const link = "underline underline-offset-2 hover:text-emerald-300";

export default function ContactPage() {
  return (
    <LegalPage title="Contact">
      <p>We read every message. For anything to do with a payment, include the reference from your Stripe receipt so we can find it quickly. We aim to reply within {COMPANY.supportReplyTime}.</p>

      <Section title="Email">
        <p className="text-lg">
          {isPlaceholder(COMPANY.email) ? (
            <Fill value={COMPANY.email} />
          ) : (
            <a className={link} href={`mailto:${COMPANY.email}`}>
              {COMPANY.email}
            </a>
          )}
        </p>
        <p>For support, refunds, and privacy requests alike. There is no contact form: we do not collect your message on this site.</p>
      </Section>

      <Section title="Lost a download?">
        <p>
          You can usually fix it yourself in a minute: use the <Link href="/recover" className={link}>Recover page</Link> with the email address from your Stripe receipt, then upload the same file again.
        </p>
      </Section>

      <Section title="Company details">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
          <dt className="text-neutral-500">Operator</dt>
          <dd><Fill value={COMPANY.legalName} /></dd>
          <dt className="text-neutral-500">Registered office</dt>
          <dd>
            <Fill value={COMPANY.street} />, <Fill value={COMPANY.postalCode} /> <Fill value={COMPANY.city} />, {COMPANY.country}
          </dd>
          <dt className="text-neutral-500">Company ID (IČO)</dt>
          <dd><Fill value={COMPANY.companyId} /></dd>
          <dt className="text-neutral-500">VAT ID (DIČ)</dt>
          <dd><Fill value={COMPANY.vatId} /></dd>
          <dt className="text-neutral-500">Commercial register</dt>
          <dd><Fill value={COMPANY.register} /></dd>
          {COMPANY.phone && (
            <>
              <dt className="text-neutral-500">Phone</dt>
              <dd>{COMPANY.phone}</dd>
            </>
          )}
        </dl>
      </Section>

      <Section title="Complaints">
        <p>
          If we cannot resolve a complaint with you as a consumer, you may turn to {COMPANY.adrBody.name}, <a className={link} href={COMPANY.adrBody.website}>{COMPANY.adrBody.website}</a>. See our{" "}
          <Link href="/terms" className={link}>Terms of Service</Link> and <Link href="/privacy" className={link}>Privacy Policy</Link> for details.
        </p>
      </Section>
    </LegalPage>
  );
}
