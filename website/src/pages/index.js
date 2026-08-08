import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

export default function Home() {
  return (
    <Layout
      title="SuperDomestique"
      description="SuperDomestique, currently shipped as faff, is governed autonomous delivery backed by deterministic evidence."
    >
      <main
        style={{
          maxWidth: '46rem',
          margin: '0 auto',
          padding: '4rem 1.5rem',
          textAlign: 'center',
        }}
      >
        <h1>SuperDomestique</h1>
        <p style={{ fontSize: '1.4rem', fontWeight: 600 }}>
          Currently shipped as <code>faff</code>.
        </p>
        <p style={{ fontSize: '1.2rem' }}>
          Governed autonomy reduces scheduled human attention only when named
          controls, evidence and failure paths earn trust for a workload.
        </p>
        <p>
          SuperDomestique names the delivery product. Commissaire names the
          governance responsibility inside the current <code>faff</code>{' '}
          repository, not a separately shipped component or security boundary.
          L3 is the current unattended centre; L4 mechanisms exist, but the
          evidence for an unqualified L4-complete claim remains incomplete.
        </p>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: '2rem',
          }}
        >
          <Link
            className="button button--primary button--lg"
            to="/guide/adopting-by-change-class"
          >
            Adopt by trust rung
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/concept/positioning-and-language"
          >
            Positioning and evidence
          </Link>
        </div>
      </main>
    </Layout>
  );
}
