# Assistente Plurall

Extensão Chrome para auxiliar na leitura e análise de questões do Plurall usando Ollama local.

## Estrutura

- `extension/`: arquivos da extensão Manifest V3.

## Requisitos

- [Ollama](https://ollama.com/) instalado e em execução.
- Modelo de visão `qwen2.5vl:7b` (leitura de imagens).
- Modelo de texto `qwen3:8b` (análise e resposta das questões).

Instale os modelos pelo terminal:

```bash
ollama pull qwen2.5vl:7b
ollama pull qwen3:8b
```

Confirme que o Ollama está disponível em `http://127.0.0.1:11434` antes de usar a extensão.

## Como carregar

1. Instale o Ollama e os dois modelos listados acima.
2. Abra `chrome://extensions`.
3. Ative o modo do desenvolvedor.
4. Clique em **Carregar sem compactação** e selecione a pasta `extension`.

Não inclua modelos, tokens ou dados de contas neste repositório.
