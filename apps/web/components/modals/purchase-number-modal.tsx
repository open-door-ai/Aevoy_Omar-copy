"use client";

import { useState } from "react";
import { Phone, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PurchaseNumberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (number: string) => void;
}

interface AvailableNumber {
  phone_number: string;
  friendly_name: string;
  locality: string;
  region: string;
}

export function PurchaseNumberModal({ isOpen, onClose, onSuccess }: PurchaseNumberModalProps) {
  const [areaCode, setAreaCode] = useState("778");
  const [pattern, setPattern] = useState("any");
  const [searchResults, setSearchResults] = useState<AvailableNumber[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (areaCode.length !== 3) {
      setError("Area code must be 3 digits");
      return;
    }

    setIsSearching(true);
    setError(null);
    setSearchResults([]);
    setSelectedNumber(null);

    try {
      const res = await fetch("/api/phone/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area_code: areaCode, pattern }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Search failed");
      }

      const data = await res.json();
      setSearchResults(data.numbers || []);

      if (data.numbers?.length === 0) {
        setError("No numbers found for this area code. Try a different one.");
      }
    } catch (err) {
      console.error("Search error:", err);
      setError(err instanceof Error ? err.message : "Failed to search numbers. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const handlePurchase = async () => {
    if (!selectedNumber) return;

    setIsPurchasing(true);
    setError(null);

    try {
      const res = await fetch("/api/phone/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: selectedNumber }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Purchase failed");
      }

      onSuccess(selectedNumber);
      onClose();
    } catch (err) {
      console.error("Purchase error:", err);
      setError(err instanceof Error ? err.message : "Failed to purchase number. Please try again or contact support.");
    } finally {
      setIsPurchasing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-semibold">Purchase Your Own Number</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Search Form */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="areaCode">Area Code</Label>
              <Input
                id="areaCode"
                type="text"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                placeholder="778"
                maxLength={3}
                className="font-mono mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter your preferred area code (e.g., 778 for Vancouver, 416 for Toronto, 212 for NYC)
              </p>
            </div>

            <div>
              <Label htmlFor="pattern">Pattern</Label>
              <select
                id="pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-2"
              >
                <option value="any">Any available number</option>
                <option value="easy">Easy to remember (repeating/sequential digits)</option>
              </select>
            </div>

            <Button
              onClick={handleSearch}
              disabled={isSearching || areaCode.length !== 3}
              className="w-full"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Searching...
                </>
              ) : (
                "Search Numbers"
              )}
            </Button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">Available Numbers</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto border border-border rounded-lg p-2">
                {searchResults.map((num) => (
                  <button
                    key={num.phone_number}
                    onClick={() => setSelectedNumber(num.phone_number)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedNumber === num.phone_number
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50 hover:bg-accent"
                    }`}
                  >
                    <div className="font-mono text-lg">{num.phone_number}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {num.locality}, {num.region}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Purchase Confirmation */}
          {selectedNumber && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-sm">Selected Number</h4>
                  <p className="text-2xl font-mono mt-1">{selectedNumber}</p>
                  <p className="text-xs text-foreground/70 mt-1">
                    $2/mo • First charge on next billing cycle
                  </p>
                </div>
                <Button
                  onClick={handlePurchase}
                  disabled={isPurchasing}
                  size="lg"
                >
                  {isPurchasing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Purchasing...
                    </>
                  ) : (
                    "Purchase"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
