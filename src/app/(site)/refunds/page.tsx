import Link from "next/link";
import { COMPANY } from "../../../site/company";
import { CONSENT_STATEMENT, guaranteeSentence } from "../../../site/legal";
import { pageMetadata } from "../../../site/metadata";
import { Fill } from "../../components/site/fill";
import { Callout, LegalPage, List, Section } from "../../components/site/legal-page";
import { FREE_ROW_LIMIT } from "../../utils/pricing";

export const metadata = pageMetadata({
  title: "Refund Policy",
  description: `Refunds for ${COMPANY.brandName}: our ${COMPANY.goodwillDays}-day money-back guarantee, the 14-day withdrawal right and how it works for an instantly delivered digital file, faulty files, and how to ask.`,
  path: "/refunds",
});

const link = "underline underline-offset-2 hover:text-emerald-300";

export default function RefundsPage() {
  return (
    <LegalPage title="Refund Policy">
      <p>
        Effective from <Fill value={COMPANY.effectiveDate} />. This policy explains refunds for the complete cleaned file, which is a digital download delivered immediately after payment. It forms part of our{" "}
        <Link href="/terms" className={link}>Terms of Service</Link>.
      </p>

      <Callout>
        <p>
          <strong>In short:</strong> if the cleaned file doesn&rsquo;t work for you, you get a full refund within {COMPANY.goodwillDays} days, no questions asked. Separately, because the file is delivered instantly, you give up the
          usual 14-day withdrawal right when you buy it, and your legal rights for a file that is not delivered, is faulty or does not match what we described are not affected.
        </p>
      </Callout>

      <Section title="1. The 14-day right of withdrawal, and why it ends on delivery">
        <p>
          Consumers who buy online normally have 14 days to withdraw without giving a reason. For digital content that is not on a tangible medium, the law (Section 1837(l) of the Czech Civil Code; Article 16(m) of Directive
          2011/83/EU) lets that right end once delivery has begun, but only if you first expressly agreed to immediate delivery and were told you would lose the right.
        </p>
        <p>We therefore ask you to confirm the following in the payment page, in a required checkbox, before you can pay:</p>
        <Callout>
          <p>&ldquo;{CONSENT_STATEMENT}&rdquo;</p>
        </Callout>
        <p>
          Once the file has been delivered after your confirmation, the right of withdrawal no longer applies. Until then it does: if your payment is taken but the file is not delivered, you can withdraw and we will refund you in full.
        </p>
        <p>The free preview, free downloads (files up to {FREE_ROW_LIMIT} rows) and your free first big file cost nothing, so there is nothing to refund.</p>
      </Section>

      <Section title="2. If something is wrong with the file">
        <p>Your legal rights as a consumer are not affected by anything in this policy. In particular, you are entitled to a remedy if:</p>
        <List>
          <li>the file was paid for but could not be delivered or downloaded;</li>
          <li>the file does not match what we described (for example it is missing rows, or columns are mangled); or</li>
          <li>you were charged more than once for the same file.</li>
        </List>
        <p>
          The remedies are the ones the law provides for digital content that does not conform to the contract (Directive (EU) 2019/770 as implemented in Czech law): we bring the file into conformity, or, where that is not
          possible or fails, you can have a price reduction or end the contract and receive a refund.
        </p>
      </Section>

      <Section title={`3. Our ${COMPANY.goodwillDays}-day money-back guarantee`}>
        <Callout>
          <p>
            <strong>{guaranteeSentence()}</strong>
          </p>
        </Callout>
        <List>
          <li>It applies to every purchase of the complete file, from consumers and businesses alike. You do not have to give a reason or prove a fault.</li>
          <li>The {COMPANY.goodwillDays} days start when the file is delivered (when you pay). Ask within that time and we refund the full price you paid, including any tax charged on it.</li>
          <li>
            It is a promise we make on top of the law. It is separate from the right of withdrawal in section 1, which you give up in the payment page, and it does not limit the rights in section 2, which stay with you
            throughout.
          </li>
          <li>Your free first big file and files up to {FREE_ROW_LIMIT} rows cost nothing, so there is nothing to refund.</li>
        </List>
      </Section>

      <Section title="4. How to ask">
        <p>
          Email <Fill value={COMPANY.email} /> with the reference from your Stripe receipt (or the last characters of your session ID, shown on the <Link href="/recover" className={link}>Recover page</Link>) and a short
          description of the problem (for the guarantee in section 3 you only need to say you want your money back). We aim to reply within {COMPANY.supportReplyTime}.
        </p>
      </Section>

      <Section title="5. How refunds are paid">
        <p>
          Refunds go back to the payment method you used, through Stripe. We make the refund without undue delay and in any case within 14 days of agreeing that you are entitled to it. Your bank may take a few more days to show it.
          Where tax was charged on the purchase, it is refunded with the price.
        </p>
      </Section>

      <Section title="6. Business customers">
        <p>
          If you buy for your business, the consumer right of withdrawal does not apply. The {COMPANY.goodwillDays}-day money-back guarantee in section 3 does apply to you, and we will still fix or refund a file that could not be delivered or that fails because of our fault.
        </p>
      </Section>
    </LegalPage>
  );
}
