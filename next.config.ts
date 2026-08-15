import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false, // не генерировать AGENTS.md/CLAUDE.md — держим структуру проекта минимальной
};

export default nextConfig;
