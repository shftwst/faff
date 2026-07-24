// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const { themes: prismThemes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'faff',
  tagline: 'Safe to stop watching.',

  // Set the production url of your site here
  url: 'https://shftwst.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // This is a project (not user/org) Pages site, so baseUrl carries the repo name.
  baseUrl: '/faff/',

  // GitHub pages deployment config.
  organizationName: 'shftwst',
  projectName: 'faff',

  // First slice: rewrite the two known out-of-tree links to absolute GitHub URLs
  // (see docs/guide/governance-check.md, docs/guide/releasing.md) and warn on
  // anything unforeseen rather than hard-failing the build (FAFF-508).
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  // The guide Markdown is plain CommonMark, not MDX — it carries curly
  // braces and other MDX-expression-shaped text (CLI flag tables) that trips
  // the MDX parser. Force classic Markdown parsing site-wide so the existing
  // canonical files render unmodified (FAFF-508: read in place, no rewrite
  // for the site's benefit).
  markdown: {
    format: 'md',
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
        sidebarPath: require.resolve('./sidebars.js'),
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
    // to pick a "landing" doc). Redirect the section root to its first doc
    // so the navbar/footer/landing-page links to /guide and /concept above
    // resolve to a real page instead of 404ing.
    [
      '@docusaurus/plugin-client-redirects',
      /** @type {import('@docusaurus/plugin-client-redirects').Options} */
      ({
        redirects: [
          { to: '/guide/adopting-by-change-class', from: '/guide' },
          { to: '/concept/intro', from: '/concept' },
        ],
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'faff',
        items: [
          {
            to: '/guide',
            label: 'Guide',
            position: 'left',
          },
          {
            to: '/concept',
            label: 'Concept',
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
              { label: 'Guide', to: '/guide' },
              { label: 'Concept', to: '/concept' },
            ],
          },
          {
            title: 'More',
            items: [
              { label: 'GitHub', href: 'https://github.com/shftwst/faff' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} faff. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

module.exports = config;
