import { ArrowLeft, BadgeCheck, Eye, LockKeyhole, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';

const responsibilities = [
  {
    icon: Eye,
    title: 'Stay within the approved scope',
    description: 'Use the permission only for its approved client, project, line of business, and work purpose. This acknowledgement does not grant access or replace your organization\'s approval process.',
  },
  {
    icon: LockKeyhole,
    title: 'Protect the information you can access',
    description: 'Client and personal information may be sensitive. Follow applicable privacy, security, confidentiality, retention, and handling requirements. Do not copy, download, or share information unless your work and policy allow it.',
  },
  {
    icon: TriangleAlert,
    title: 'Report concerns and changes',
    description: 'Keep your credentials secure. Promptly report suspected misuse, accidental disclosure, or access that is no longer needed. Stop using access that has expired, changed, or been revoked.',
  },
];

export default function RiskAcceptancePage() {
  return (
    <section className="page-section risk-acceptance-page" aria-labelledby="risk-acceptance-title">
      <Link className="risk-back-link" to="/approvals"><ArrowLeft size={16} aria-hidden="true" />Back to approvals</Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Permission responsibilities</p>
          <h1 id="risk-acceptance-title">Risk acceptance</h1>
          <p className="page-subtitle">Understand the responsibilities that come with additional access.</p>
        </div>
      </div>

      <div className="risk-disclosure">
        <div className="risk-disclosure-intro">
          <span className="risk-disclosure-icon"><TriangleAlert size={20} aria-hidden="true" /></span>
          <div>
            <h2>Access carries responsibility</h2>
            <p>Additional permissions can expose confidential, client, or personal information. Your access must remain limited to the work and scope formally approved for you.</p>
          </div>
        </div>

        <div className="risk-responsibilities">
          {responsibilities.map(({ icon: Icon, title, description }) => (
            <article className="risk-responsibility" key={title}>
              <Icon size={18} aria-hidden="true" />
              <div><h3>{title}</h3><p>{description}</p></div>
            </article>
          ))}
        </div>

        <div className="risk-acknowledgement-note">
          <BadgeCheck size={18} aria-hidden="true" />
          <p>Recording your acknowledgement confirms that you have read these responsibilities. It is not an access request, authorization, or substitute for your organization\'s policies and approvals.</p>
        </div>
      </div>
    </section>
  );
}