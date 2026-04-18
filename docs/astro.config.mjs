import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Panopticon Docs',
      description: 'AI Agent & MCP Observability Platform',
      social: {
        github: 'https://github.com/panopticon-oss/panopticon',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', link: '/guides/introduction/' },
            { label: 'Quick Start', link: '/guides/quickstart/' },
            { label: 'Architecture', link: '/guides/architecture/' },
          ],
        },
        {
          label: 'SDKs',
          items: [
            { label: 'TypeScript SDK', link: '/sdks/typescript/' },
            { label: 'Python SDK', link: '/sdks/python/' },
          ],
        },
        {
          label: 'Integrations',
          items: [
            { label: 'LangChain', link: '/integrations/langchain/' },
            { label: 'CrewAI', link: '/integrations/crewai/' },
            { label: 'MCP Servers', link: '/integrations/mcp/' },
          ],
        },
        {
          label: 'Deployment',
          items: [
            { label: 'Docker Compose', link: '/deployment/docker/' },
            { label: 'Kubernetes / Helm', link: '/deployment/kubernetes/' },
          ],
        },
        {
          label: 'API Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
    }),
  ],
});
