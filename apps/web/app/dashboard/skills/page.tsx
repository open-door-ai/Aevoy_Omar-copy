'use client';

import { useState, useEffect } from 'react';
import { Search, Package, CheckCircle, AlertCircle, Star, TrendingUp, Zap, Shield } from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'curated' | 'mcp' | 'n8n';
  provider: string;
  category: string;
  costPerUse: number;
  trustLevel: 'verified' | 'community_verified' | 'unverified';
  version?: string;
  author?: string;
  installed?: boolean;
  securityScore?: number;
}

interface SkillSearchResult {
  skills: Skill[];
  totalCount: number;
  sources: {
    curated: number;
    mcp: number;
    n8n: number;
  };
}

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'https://hissing-verile-aevoy-e721b4a6.koyeb.app';

export default function SkillsMarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<'all' | 'curated' | 'mcp' | 'n8n'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [sources, setSources] = useState({ curated: 0, mcp: 0, n8n: 0 });

  const categories = [
    'all',
    'productivity',
    'communication',
    'data',
    'automation',
    'ai',
    'analytics',
    'calendar',
    'email',
    'spreadsheet',
  ];

  useEffect(() => {
    searchSkills();
  }, [selectedSource, selectedCategory]);

  const searchSkills = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        q: searchQuery || '',
        limit: '50',
      });

      if (selectedSource !== 'all') {
        params.set('sources', selectedSource);
      }

      if (selectedCategory !== 'all') {
        params.set('category', selectedCategory);
      }

      const response = await fetch(`${AGENT_URL}/skills/search?${params}`);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data: SkillSearchResult = await response.json();

      setSkills(data.skills);
      setTotalCount(data.totalCount);
      setSources(data.sources || { curated: 0, mcp: 0, n8n: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      console.error('[SKILLS-UI] Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchSkills();
  };

  const installSkill = async (skillId: string) => {
    // TODO: Implement installation via API
    console.log('[SKILLS-UI] Installing skill:', skillId);
    alert(`Installing skill: ${skillId}\n\nThis will trigger security audit and V8 sandbox loading.`);
  };

  const getTrustBadge = (trustLevel: string) => {
    switch (trustLevel) {
      case 'verified':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <Shield className="w-3 h-3 mr-1" />
            Verified
          </span>
        );
      case 'community_verified':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Community
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            <AlertCircle className="w-3 h-3 mr-1" />
            Unverified
          </span>
        );
    }
  };

  const getSourceBadge = (source: string) => {
    const badges = {
      curated: { label: 'Aevoy', color: 'bg-purple-100 text-purple-800' },
      mcp: { label: 'MCP', color: 'bg-indigo-100 text-indigo-800' },
      n8n: { label: 'n8n', color: 'bg-orange-100 text-orange-800' },
    };

    const badge = badges[source as keyof typeof badges] || { label: source, color: 'bg-gray-100 text-gray-800' };

    return <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${badge.color}`}>{badge.label}</span>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-900 to-black p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Skills Marketplace</h1>
          <p className="text-gray-400">
            Discover and install {totalCount.toLocaleString()}+ skills from curated, MCP, and n8n registries
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total Skills</p>
                <p className="text-2xl font-bold text-white">{totalCount.toLocaleString()}</p>
              </div>
              <Package className="w-8 h-8 text-purple-500" />
            </div>
          </div>

          <div className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Curated</p>
                <p className="text-2xl font-bold text-white">{sources.curated}</p>
              </div>
              <Star className="w-8 h-8 text-yellow-500" />
            </div>
          </div>

          <div className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">MCP Registry</p>
                <p className="text-2xl font-bold text-white">{sources.mcp}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-indigo-500" />
            </div>
          </div>

          <div className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">n8n Community</p>
                <p className="text-2xl font-bold text-white">{sources.n8n}</p>
              </div>
              <Zap className="w-8 h-8 text-orange-500" />
            </div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-6 mb-6">
          <form onSubmit={handleSearch} className="mb-4">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search skills (e.g., 'google sheets', 'slack', 'calendar')..."
                  className="w-full pl-10 pr-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </form>

          <div className="flex flex-wrap gap-4">
            {/* Source Filter */}
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Source</label>
              <div className="flex gap-2">
                {(['all', 'curated', 'mcp', 'n8n'] as const).map((source) => (
                  <button
                    key={source}
                    onClick={() => setSelectedSource(source)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      selectedSource === source
                        ? 'bg-purple-600 text-white'
                        : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
                    }`}
                  >
                    {source === 'all' ? 'All' : source.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Filter */}
            <div className="flex-1">
              <label className="text-sm text-gray-400 mb-2 block">Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* Skills Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
            <p className="text-gray-400 mt-4">Searching skills...</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">No skills found</p>
            <p className="text-gray-500 text-sm mt-2">Try a different search query or filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="bg-zinc-800/50 backdrop-blur-sm border border-zinc-700 rounded-lg p-5 hover:border-purple-500/50 transition-all group"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-white font-semibold text-lg mb-1 group-hover:text-purple-400 transition-colors">
                      {skill.name}
                    </h3>
                    <p className="text-gray-400 text-xs">{skill.provider}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {getSourceBadge(skill.source)}
                    {getTrustBadge(skill.trustLevel)}
                  </div>
                </div>

                {/* Description */}
                <p className="text-gray-300 text-sm mb-4 line-clamp-2">{skill.description}</p>

                {/* Metadata */}
                <div className="flex items-center gap-3 mb-4 text-xs text-gray-400">
                  {skill.version && <span>v{skill.version}</span>}
                  {skill.category && <span className="capitalize">{skill.category}</span>}
                  {skill.costPerUse !== undefined && (
                    <span className={skill.costPerUse === 0 ? 'text-green-400' : 'text-yellow-400'}>
                      {skill.costPerUse === 0 ? 'Free' : `$${skill.costPerUse.toFixed(2)}`}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <button
                  onClick={() => installSkill(skill.id)}
                  className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {skill.installed ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Installed
                    </>
                  ) : (
                    <>
                      <Package className="w-4 h-4" />
                      Install Skill
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer Info */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>
            All skills are security-audited with 3-layer verification (static analysis + AI review + sandbox
            execution)
          </p>
          <p className="mt-1">Skills run in V8 isolated contexts with restricted permissions</p>
        </div>
      </div>
    </div>
  );
}
