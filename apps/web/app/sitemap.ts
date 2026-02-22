import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://www.aevoy.com", lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: "https://www.aevoy.com/how-it-works", lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: "https://www.aevoy.com/security", lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: "https://www.aevoy.com/hive", lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: "https://www.aevoy.com/store", lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: "https://www.aevoy.com/login", lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: "https://www.aevoy.com/signup", lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: "https://www.aevoy.com/legal/privacy", lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: "https://www.aevoy.com/legal/terms", lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];
}
