const LOGO_DEV_TOKEN = "pk_Y3T8VgQcSSCD7X7ioaY8pQ"

const providerBrand = (provider: string) => {
  const key = provider.trim().toLocaleLowerCase()
  if (key.includes("azure")) return { identifier: "microsoft.com", name: "Microsoft" }
  if (key.includes("bedrock") || key === "aws" || key.startsWith("amazon")) return { identifier: "aws.amazon.com", name: "AWS" }
  if (key.includes("openrouter")) return { identifier: "openrouter.ai", name: "OpenRouter" }
  if (key.includes("openai") || key.includes("codex")) return { identifier: "openai.com", name: "OpenAI" }
  if (key.includes("anthropic") || key.includes("claude")) return { identifier: "anthropic.com", name: "Anthropic" }
  if (key.includes("google") || key.includes("gemini") || key.includes("vertex")) return { identifier: "google.com", name: "Google" }
  if (key.includes("github") || key.includes("copilot")) return { identifier: "github.com", name: "GitHub" }
  if (key === "xai" || key.includes("grok")) return { identifier: "x.ai", name: "xAI" }
  if (key.includes("mistral")) return { identifier: "mistral.ai", name: "Mistral AI" }
  if (key.includes("groq")) return { identifier: "groq.com", name: "Groq" }
  if (key.includes("cohere")) return { identifier: "cohere.com", name: "Cohere" }
  if (key.includes("deepseek")) return { identifier: "deepseek.com", name: "DeepSeek" }
  if (key.includes("perplexity")) return { identifier: "perplexity.ai", name: "Perplexity" }
  if (key.includes("together")) return { identifier: "together.ai", name: "Together AI" }
  if (key.includes("fireworks")) return { identifier: "fireworks.ai", name: "Fireworks AI" }
  if (key.includes("cerebras")) return { identifier: "cerebras.ai", name: "Cerebras" }
  if (key.includes("ollama")) return { identifier: "ollama.com", name: "Ollama" }

  const name = provider.replace(/[-_]+/g, " ").trim() || "AI provider"
  return { identifier: `name/${encodeURIComponent(name)}`, name }
}

export const providerLogoUrl = (provider: string, size: number) => {
  const brand = providerBrand(provider)
  const path = brand.identifier.startsWith("name/") ? brand.identifier : encodeURIComponent(brand.identifier)
  return `https://img.logo.dev/${path}?token=${LOGO_DEV_TOKEN}&size=${size}&format=webp&theme=dark&retina=true&fallback=monogram`
}

export function ProviderLogo({ provider, size = 16 }: { readonly provider: string; readonly size?: number }) {
  const brand = providerBrand(provider)
  return <img className="provider-logo" src={providerLogoUrl(provider, size)} alt={`${brand.name} logo`} width={size} height={size} loading="lazy" decoding="async" />
}
