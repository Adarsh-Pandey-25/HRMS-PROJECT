import { SITE } from '../siteConfig';
import { LegalPage, grievanceContact } from '../components/LegalPage';

export function Privacy() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={`${SITE.legalName} (“we”, “us”) runs ${SITE.name} at ${SITE.url} and on company workspace addresses under spaxsync.com. This policy explains what personal data we handle and how, in line with the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.`}
      sections={[
        {
          heading: 'Two kinds of data',
          body: [
            'Website and account data: when you visit this site, request a trial, contact us or sign up, we decide why and how that data is used, and we are responsible for it.',
            'Employee data inside a workspace: when a company uses SpaxSync to manage its employees, that company decides what data is collected and why. We process it only on the company’s instructions to provide the service. Employees should contact their employer first about their data.',
          ],
        },
        {
          heading: 'What we collect',
          body: [
            'From trial and contact forms: your name, work email, phone number (optional), company name and size, and your message. We also record the IP address and browser of the request to prevent abuse.',
            'Inside workspaces: the employee records, attendance, leave, payroll and documents that the company or its employees enter, plus sign-in and security logs.',
          ],
        },
        {
          heading: 'How we use it',
          body: 'To respond to your request, set up and run your workspace, send service emails (such as invites, password resets and billing notices), keep the service secure, and meet legal obligations. We do not sell personal data and do not use employee data for advertising.',
        },
        {
          heading: 'Who we share it with',
          body: 'Service providers that host and run SpaxSync for us — cloud hosting, database and file storage, and email delivery — under contracts that limit them to providing that service. We disclose data to authorities only where the law requires it.',
        },
        {
          heading: 'How long we keep it',
          body: 'Workspace data is kept while the company’s account is active and then deleted or returned according to our agreement with that company. Enquiries from this site are kept for as long as needed to follow up and for our records, and then deleted.',
        },
        {
          heading: 'Your rights',
          body: 'You can ask to access, correct or erase your personal data, withdraw consent, and nominate someone to exercise these rights for you. For data inside a workspace, contact your employer, who controls it; we will help them respond.',
        },
        {
          heading: 'Security',
          body: 'We protect data with access controls, encryption in transit, isolated company workspaces and audit logging. See our Security page for details.',
        },
        {
          heading: 'Grievance Officer',
          body: `For questions or complaints about your personal data, contact our Grievance Officer: ${grievanceContact()}. We will acknowledge your complaint and respond within the time limits set by law.`,
        },
        {
          heading: 'Changes',
          body: 'If we change this policy we will update the date above, and tell workspace admins by email about significant changes.',
        },
      ]}
    />
  );
}

export function Terms() {
  return (
    <LegalPage
      title="Terms of service"
      intro={`These terms are an agreement between ${SITE.legalName} and the company that signs up for ${SITE.name} (“you”). By creating a workspace or using the service you accept them on behalf of your company.`}
      sections={[
        { heading: 'The service', body: `${SITE.name} is an online HR platform. We provide it on a subscription basis and may improve or change features over time. We will give notice before removing a feature your plan depends on.` },
        { heading: 'Your account', body: 'You are responsible for the people you give access to, for keeping sign-in details secure, and for the accuracy of the data you enter. Tell us promptly if you suspect unauthorised access.' },
        { heading: 'Free trial', body: `New workspaces start with a ${SITE.trial.length} free trial. When it ends, sign-in is paused until you choose a paid plan; your data is kept.` },
        { heading: 'Plans, seats and payment', body: 'Fees depend on your plan, billing cycle and number of active employees (seats). Prices are in Indian rupees and exclusive of GST, which is added to your invoice. Invoices are due on receipt. If payment is overdue we may, after notice, restrict access until it is paid.' },
        { heading: 'Your data', body: 'You own the data you put into SpaxSync. You give us permission to host and process it only to provide the service. You are responsible for having a lawful basis and giving any notices needed to collect your employees’ data. You can export your data while your account is active.' },
        { heading: 'Acceptable use', body: 'Do not use the service to break the law, to upload malicious code, to try to access other companies’ data, or to overload or reverse-engineer the platform.' },
        { heading: 'Cancellation', body: 'You can cancel anytime from Subscription & Billing in your workspace. Cancellation takes effect at the end of the current billing period. See the Refund & cancellation policy.' },
        { heading: 'Liability', body: 'We provide the service with reasonable care and skill. To the extent the law allows, our total liability for any claim is limited to the fees you paid us in the 12 months before the claim, and we are not liable for indirect or consequential losses.' },
        { heading: 'Law and disputes', body: 'These terms are governed by the laws of India. Courts at the place of our registered office have jurisdiction.' },
        { heading: 'Contact', body: `Questions about these terms: ${SITE.supportEmail}.` },
      ]}
    />
  );
}

export function RefundPolicy() {
  return (
    <LegalPage
      title="Refund & cancellation policy"
      sections={[
        { heading: 'Free trial', body: `The ${SITE.trial.length} trial is free and needs no card. Nothing is charged when it ends.` },
        { heading: 'Cancelling', body: 'You can cancel your subscription anytime from Subscription & Billing. Your plan stays active until the end of the period you have paid for and does not renew after that.' },
        { heading: 'Refunds', body: 'Subscription fees already paid are not refunded for partly used periods. If you were charged in error — for example a duplicate payment or a wrong amount — tell us and we will refund the difference to the original payment method.' },
        { heading: 'Plan and seat changes', body: 'When you upgrade, downgrade or change seats mid-period, the difference for the rest of the period is prorated on your next invoice.' },
        { heading: 'Contact', body: `For billing questions or refund requests write to ${SITE.salesEmail}.` },
      ]}
    />
  );
}

export function Security() {
  return (
    <LegalPage
      title="Security"
      intro={`HR data is some of the most sensitive data a company holds. Here is how ${SITE.name} protects it.`}
      sections={[
        { heading: 'Isolated workspaces', body: 'Every company has its own workspace at its own address. Each request is checked against the workspace it came from, so one company can never sign in to, or read data from, another.' },
        { heading: 'Access control', body: 'Admins, HR, managers and employees each see only what their role allows. Passwords are stored as salted hashes, sign-in attempts are rate-limited, and sessions use secure, HTTP-only cookies.' },
        { heading: 'Encryption', body: 'All traffic to SpaxSync uses HTTPS. Data is encrypted at rest by our database and storage provider. Employee documents are stored privately and opened through short-lived links.' },
        { heading: 'Audit trail', body: 'Sensitive actions — such as changes to salaries, roles and settings — are written to an audit log that is chained so later tampering can be detected.' },
        { heading: 'Integrations', body: 'API keys are scoped to what they may access, and webhooks are signed so your systems can verify they came from SpaxSync.' },
        { heading: 'Reporting a problem', body: `If you think you have found a security issue, email ${SITE.supportEmail} with the details. Please do not access data that is not yours while testing.` },
      ]}
    />
  );
}
