# Motor Mundo

Base de um motor de jogo simulador de mundo aberto (Three.js + Vite), com build automático no GitHub.

## O que já tem (v0.1)
- Mundo infinito em chunks (carrega/descarrega à volta do jogador)
- Cidade procedural: estradas, edifícios, árvores, com colisões
- Jogador a pé (joystick esquerdo move, direito olha) e carro (botão Entrar/Sair)
- NPCs a vaguear
- Ciclo dia/noite com faróis do carro

## Controlos
- Telemóvel: joysticks virtuais + botão Entrar/Sair
- PC: WASD, rato (arrastar) para olhar, Shift corre, E entra/sai do carro

## Compilar no GitHub
1. Cria um repositório e envia estes ficheiros para o ramo `main`.
2. Em **Settings → Pages**, escolhe **Source: GitHub Actions**.
3. Em **Actions**, o workflow *Compilar Motor Mundo* corre sozinho:
   - **web**: publica o jogo no GitHub Pages
   - **apk**: gera o APK (descarregas em *Artifacts → motor-mundo-apk*)

## Local
```
npm install
npm run dev
```
