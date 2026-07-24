import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

/**
 * Minimal custom landing page (FAFF-508 §4): the pitch line plus two calls
 * to action. Deliberately no hero illustration, no feature grid, no theme
 * work — that polish is out of scope for this slice (see the spec's
 * section 2 exclusions). Uses the default theme unstyled.
 */
export default function Home() {
  return (
    <Layout
      title="faff"
      description="faff wraps the delivery loop — issue, spec, build, review, ship — in fixed contracts and gates. Safe to stop watching, one step at a time."
    >
      <main
        style={{
          maxWidth: '42rem',
          margin: '0 auto',
          padding: '4rem 1.5rem',
          textAlign: 'center',
        }}
      >
        <h1>faff</h1>
        <p style={{ fontSize: '1.25rem' }}>
          <em>Faff</em> (n.): the tedious palaver around the actual
          engineering. faff does it for you, and then keeps going — stage by
          stage it takes the faff out of the delivery loop until, if you
          fancy, the whole thing runs without you.
        </p>
        <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>
          It makes it safe to stop watching, one step at a time.
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
          <Link className="button button--primary button--lg" to="/guide">
            Read the guide
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/concept"
          >
            The theory
          </Link>
        </div>
      </main>
    </Layout>
  );
}
