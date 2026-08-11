// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const { themes: prismThemes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'SuperDomestique',
  tagline: 'Governed software delivery for increasingly independent agents.',

  // Set the production url of your site here
  url: 'https://shftwst.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // This is a project (not user/org) Pages site, so baseUrl carries the repo name.
  baseUrl: '/faff/',

  // GitHub pages deployment config.
  organizationName: 'shftwst',
  projectName: 'faff',

  // The docs build refuses on a broken internal route (FAFF-659): a link
  // that resolves to a page the site does not serve fails the build rather
  // than warning past it. A doc link that points outside the two routed
  // trees (docs/guide, docs/concept) is written as an absolute GitHub URL,
  // which Docusaurus never resolves; those URLs are kept honest instead by
  // the out-of-tree docs-link step in .github/workflows/validate.yml.
  onBrokenLinks: 'throw',

  // The guide Markdown is plain CommonMark, not MDX — it carries curly
  // braces and other MDX-expression-shaped text (CLI flag tables) that trips
  // the MDX parser. Force classic Markdown parsing site-wide so the existing
  // canonical files render unmodified (FAFF-508: read in place, no rewrite
  // for the site's benefit). onBrokenMarkdownLinks moved under markdown.hooks
  // here — the top-level option is deprecated in 3.10.2 (FAFF-659).
  markdown: {
    format: 'md',
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        // The classic preset's own docs instance is disabled — both reading
        // surfaces are configured as standalone plugin instances below so
        // each gets its own routeBasePath and sidebar (guide / concept).
        docs: false,
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  plugins: [
    // Guide surface — reads docs/guide in place. No copy, no fork: the path
    // points straight at the repo's own canonical Markdown tree.
    [
      '@docusaurus/plugin-content-docs',
      /** @type {import('@docusaurus/plugin-content-docs').Options} */
      ({
        id: 'guide',
        path: '../docs/guide',
        routeBasePath: 'guide',
        sidebarPath: require.resolve('./sidebars-guide.js'),
        editUrl: 'https://github.com/shftwst/faff/edit/main/docs/guide/',
      }),
    ],
    // Theory/concept surface — reads docs/concept in place, same rule.
    [
      '@docusaurus/plugin-content-docs',
      /** @type {import('@docusaurus/plugin-content-docs').Options} */
      ({
        id: 'concept',
        path: '../docs/concept',
        routeBasePath: 'concept',
        sidebarPath: require.resolve('./sidebars.js'),
        editUrl: 'https://github.com/shftwst/faff/edit/main/docs/concept/',
      }),
    ],
    // The bare /guide and /concept routes have no page of their own —
    // Docusaurus only serves individual doc pages, and the canonical guide
    // Markdown is read in place unmodified (no `slug: /` frontmatter added
    // to pick a "landing" doc). These redirects catch someone who *types*
    // /guide or /concept, or follows an external link to one.
    //
    // They do NOT cover in-app navigation, and must not be relied on for it:
    // each redirect is a static `<meta http-equiv="refresh">` file, so it only
    // runs on a full page load. A Docusaurus <Link> to a section root is
    // handled client-side by the router, which has no route for the root
    // (only for its child docs) and renders the not-found page instead. So
    // every in-app link — navbar, footer, landing page — points at a real doc
    // route, not at the section root (FAFF-658).
    [
      '@docusaurus/plugin-client-redirects',
      /** @type {import('@docusaurus/plugin-client-redirects').Options} */
      ({
        redirects: [
          { to: '/guide/intro', from: '/guide' },
          { to: '/concept/intro', from: '/concept' },
        ],
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'SuperDomestique',
        items: [
          {
            type: 'doc',
            docsPluginId: 'concept',
            docId: 'what-is-faff',
            label: 'Delivery',
            position: 'left',
          },
          {
            type: 'doc',
            docsPluginId: 'concept',
            docId: 'execution-and-governance',
            label: 'Governance',
            position: 'left',
          },
          {
            type: 'doc',
            docsPluginId: 'guide',
            docId: 'intro',
            label: 'Get started',
            position: 'left',
          },
          {
            type: 'doc',
            docsPluginId: 'concept',
            docId: 'evidence',
            label: 'Evidence',
            position: 'left',
          },
          {
            href: 'https://github.com/shftwst/faff',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Delivery', to: '/concept/what-is-faff' },
              { label: 'Governance', to: '/concept/execution-and-governance' },
              { label: 'Get started', to: '/guide/intro' },
              { label: 'Evidence', to: '/concept/evidence' },
            ],
          },
          {
            title: 'More',
            items: [
              { label: 'GitHub', href: 'https://github.com/shftwst/faff' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} SuperDomestique. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

module.exports = config;
