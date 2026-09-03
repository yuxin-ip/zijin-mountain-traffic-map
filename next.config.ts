import type { NextConfig } from 'next';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isProjectPage = process.env.GITHUB_ACTIONS === 'true' && repositoryName;

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  assetPrefix: isProjectPage ? `/${repositoryName}` : undefined,
};

export default nextConfig;
