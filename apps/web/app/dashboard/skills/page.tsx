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

export default function SkillsMarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<'all' | 'curated' | 'mcp' | 'n8n'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [sources, setSources] = useState({ curated: 0, mcp: 0, n8n: 0 });
  const [installing, setInstalling] = useState<Set<string>>(new Set());

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
      const params = new URLSearchParams();

      if (searchQuery) {
        params.set('q', searchQuery);
      }

      if (selectedCategory !== 'all') {
        params.set('category', selectedCategory);
      }

      const response = await fetch(`/api/skills?${params}`);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data: SkillSearchResult = await response.json();

      let filteredSkills = data.skills;
      if (selectedSource !== 'all') {
        filteredSkills = filteredSkills.filter((s) => s.source === selectedSource);
      }

      setSkills(filteredSkills);
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
    console.log('[SKILLS-UI] Installing skill:', skillId);
    setInstalling((prev) => new Set(prev).add(skillId));

    try {
      const response = await fetch('/api/skills/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ skillId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Installation failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[SKILLS-UI] Skill installed:', result);

      setSkills((prevSkills) =>
        prevSkills.map((skill) =>
          skill.id === skillId ? { ...skill, installed: true } : skill
        )
      );

      setError(null);
      alert(`Skill installed successfully!\n\n${result.skillId || skillId} is now ready to use.`);
    } catch (err) {
      console.error('[SKILLS-UI] Install error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Installation failed';
      setError(`Failed to install skill: ${errorMessage}`);
      alert(`Installation failed\n\n${errorMessage}`);
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    }
  };

  const getTrustBadge = (trustLevel: string) => {
    switch (trustLevel) {
      case 'verified':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <Shield className="w-3 h-3 mr-1" />
            Verified
          </span>
        );
      case 'community_verified':
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            <CheckCircle className="w-3 h-3 mr-1" />
            Community
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            <AlertCircle className="w-3 h-3 mr-1" />
            Unverified
          </span>
        );
    }
  };

  const getSourceBadge = (source: string) => {
    const badges = {
      curated: { label: 'Aevoy', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
      mcp: { label: 'MCP', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400' },
      n8n: { label: 'n8n', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' },
    };

    const badge = badges[source as keyof typeof badges] || { label: source, color: 'bg-muted text-muted-foreground' };

    return <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${badge.color}`}>{badge.label}</span>;
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Skills Marketplace</h1>
          <p className="text-muted-foreground">
            Discover and install {totalCount.toLocaleString()}+ skills from curated, MCP, and n8n registries
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card backdrop-blur-sm border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Total Skills</p>
                <p className="text-2xl font-bold text-foreground">{totalCount.toLocaleString()}</p>
              </div>
              <Package className="w-8 h-8 text-purple-500" />
            </div>
          </div>

          <div className="bg-card backdrop-blur-sm border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Curated</p>
                <p className="text-2xl font-bold text-foreground">{sources.curated}</p>
              </div>
              <Star className="w-8 h-8 text-yellow-500" />
            </div>
          </div>

          <div className="bg-card backdrop-blur-sm border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">MCP Registry</p>
                <p className="text-2xl font-bold text-foreground">{sources.mcp}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-indigo-500" />
            </div>
          </div>

          <div className="bg-card backdrop-blur-sm border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">n8n Community</p>
                <p className="text-2xl font-bold text-foreground">{sources.n8n}</p>
              </div>
              <Zap className="w-8 h-8 text-orange-500" />
            </div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="bg-card backdrop-blur-sm border border-border rounded-lg p-6 mb-6">
          <form onSubmit={handleSearch} className="mb-4">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search skills (e.g., 'google sheets', 'slack', 'calendar')..."
                  className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-500"
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
              <label className="text-sm text-muted-foreground mb-2 block">Source</label>
              <div className="flex gap-2">
                {(['all', 'curated', 'mcp', 'n8n'] as const).map((source) => (
                  <button
                    key={source}
                    onClick={() => setSelectedSource(source)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      selectedSource === source
                        ? 'bg-purple-600 text-white'
                        : 'bg-muted text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {source === 'all' ? 'All' : source.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Filter */}
            <div className="flex-1">
              <label className="text-sm text-muted-foreground mb-2 block">Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-4 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-purple-500"
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
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Skills Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
            <p className="text-muted-foreground mt-4">Searching skills...</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground text-lg">No skills found</p>
            <p className="text-muted-foreground text-sm mt-2">Try a different search query or filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="bg-card backdrop-blur-sm border border-border rounded-lg p-5 hover:border-purple-500/50 transition-all group"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-foreground font-semibold text-lg mb-1 group-hover:text-purple-500 transition-colors">
                      {skill.name}
                    </h3>
                    <p className="text-muted-foreground text-xs">{skill.provider}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {getSourceBadge(skill.source)}
                    {getTrustBadge(skill.trustLevel)}
                  </div>
                </div>

                {/* Description */}
                <p className="text-muted-foreground text-sm mb-4 line-clamp-2">{skill.description}</p>

                {/* Metadata */}
                <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
                  {skill.version && <span>v{skill.version}</span>}
                  {skill.category && <span className="capitalize">{skill.category}</span>}
                  {skill.costPerUse !== undefined && (
                    <span className={skill.costPerUse === 0 ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}>
                      {skill.costPerUse === 0 ? 'Free' : `$${skill.costPerUse.toFixed(2)}`}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <button
                  onClick={() => installSkill(skill.id)}
                  disabled={installing.has(skill.id) || skill.installed}
                  className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {installing.has(skill.id) ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Installing...
                    </>
                  ) : skill.installed ? (
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
        <div className="mt-8 text-center text-muted-foreground text-sm">
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
