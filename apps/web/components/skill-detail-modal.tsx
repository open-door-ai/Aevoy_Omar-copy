'use client';

import { X, Package, Shield, Code, Play, CheckCircle, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { useState } from 'react';

export interface SkillDetail {
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
  method?: string;
  api_endpoint?: string | null;
  input_schema?: Record<string, any> | null;
  required_scopes?: string[];
}

interface SkillDetailModalProps {
  skill: SkillDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (skillId: string) => void;
  installing: boolean;
}

export function SkillDetailModal({ skill, isOpen, onClose, onInstall, installing }: SkillDetailModalProps) {
  const [testParams, setTestParams] = useState<string>('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  if (!isOpen || !skill) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const params = JSON.parse(testParams || '{}');

      const response = await fetch('/api/skills/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          skillId: skill.id,
          params,
        }),
      });

      if (!response.ok) {
        throw new Error(`Execution failed: ${response.statusText}`);
      }

      const result = await response.json();
      setTestResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setTestResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTesting(false);
    }
  };

  const getTrustBadge = () => {
    switch (skill.trustLevel) {
      case 'verified':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <Shield className="w-4 h-4 mr-1" />
            Verified
          </span>
        );
      case 'community_verified':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            <CheckCircle className="w-4 h-4 mr-1" />
            Community Verified
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-muted text-muted-foreground">
            <AlertCircle className="w-4 h-4 mr-1" />
            Unverified
          </span>
        );
    }
  };

  const renderInputSchema = () => {
    if (!skill.input_schema) return <p className="text-muted-foreground text-sm">No parameters defined</p>;

    return (
      <div className="space-y-2">
        {Object.entries(skill.input_schema).map(([key, type]) => (
          <div key={key} className="flex items-start gap-3 p-2 bg-muted/30 rounded">
            <Code className="w-4 h-4 text-purple-500 mt-0.5" />
            <div className="flex-1">
              <code className="text-sm font-mono text-foreground">{key}</code>
              <span className="text-xs text-muted-foreground ml-2">{String(type)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-foreground">{skill.name}</h2>
              {getTrustBadge()}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="capitalize">{skill.provider}</span>
              <span>•</span>
              <span className="capitalize">{skill.category}</span>
              {skill.version && (
                <>
                  <span>•</span>
                  <span>v{skill.version}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
              <Info className="w-5 h-5 text-purple-500" />
              Description
            </h3>
            <p className="text-muted-foreground">{skill.description}</p>
          </div>

          {/* API Details */}
          {skill.api_endpoint && (
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                <ExternalLink className="w-5 h-5 text-purple-500" />
                API Endpoint
              </h3>
              <div className="bg-muted/30 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-1 bg-purple-600 text-white text-xs font-mono rounded">
                    {skill.method || 'GET'}
                  </span>
                  <code className="text-sm font-mono text-foreground">{skill.api_endpoint}</code>
                </div>
                {skill.required_scopes && skill.required_scopes.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">Required Scopes:</p>
                    <div className="flex flex-wrap gap-1">
                      {skill.required_scopes.map((scope, idx) => (
                        <code key={idx} className="px-2 py-0.5 bg-background rounded text-xs font-mono text-muted-foreground">
                          {scope}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Input Schema */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
              <Code className="w-5 h-5 text-purple-500" />
              Parameters
            </h3>
            {renderInputSchema()}
          </div>

          {/* Security Info */}
          {skill.securityScore !== undefined && (
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                <Shield className="w-5 h-5 text-purple-500" />
                Security
              </h3>
              <div className="bg-muted/30 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Security Score</span>
                  <span className="text-sm font-semibold text-foreground">{skill.securityScore}/100</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full transition-all"
                    style={{ width: `${skill.securityScore}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  ✓ Static analysis passed • ✓ AI review passed • ✓ Sandbox execution verified
                </p>
              </div>
            </div>
          )}

          {/* Test Execution */}
          {skill.installed && (
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                <Play className="w-5 h-5 text-purple-500" />
                Test Execution
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">
                    Parameters (JSON)
                  </label>
                  <textarea
                    value={testParams}
                    onChange={(e) => setTestParams(e.target.value)}
                    placeholder='{"filename": "test.xlsx", "sheets": [...]}'
                    className="w-full px-3 py-2 bg-background border border-border rounded font-mono text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={4}
                  />
                </div>
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  {testing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Test Skill
                    </>
                  )}
                </button>
                {testResult && (
                  <div className="mt-3">
                    <label className="text-sm text-muted-foreground mb-1 block">Result</label>
                    <pre className="w-full px-3 py-2 bg-muted rounded font-mono text-xs text-foreground overflow-x-auto">
                      {testResult}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cost Info */}
          <div className="bg-muted/30 rounded p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Cost per use</span>
              <span className={`text-lg font-semibold ${skill.costPerUse === 0 ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                {skill.costPerUse === 0 ? 'Free' : `$${skill.costPerUse.toFixed(3)}`}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-card border-t border-border p-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-muted hover:bg-accent text-foreground font-medium rounded-lg transition-colors"
          >
            Close
          </button>
          {!skill.installed && (
            <button
              onClick={() => onInstall(skill.id)}
              disabled={installing}
              className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {installing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Package className="w-4 h-4" />
                  Install Skill
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
