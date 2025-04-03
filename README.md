# EzMeme

EzMeme est une extension qui permet de faciliter le téléchargement et l'analyse de contenus Instagram pour la création de mèmes.

## Fonctionnalités

- Téléchargement de vidéos et d'audios Instagram
- Extraction de la description et des hashtags
- Reconnaissance de texte (OCR) dans les vidéos
- Interface utilisateur intuitive en extension de navigateur

## Prérequis

- Node.js (v14+)
- Python (v3.8+)
- Conda (pour gérer l'environnement Python)
- Une clé API OpenAI

## Installation

1. Cloner le dépôt

```bash
git clone https://github.com/votre-nom/EzMeme.git
cd EzMeme
```

2. Installer les dépendances Node.js

```bash
npm install
```

3. Créer et configurer l'environnement Conda

```bash
conda create -n ezmeme python=3.8
conda activate ezmeme
pip install -r easyocr/requirements.txt
```

4. Configurer les variables d'environnement

```bash
cp .env-example .env
```

Puis modifiez le fichier `.env` pour y ajouter votre clé API OpenAI.

## Utilisation

1. Démarrer le serveur

```bash
npm start
```

2. Utiliser l'extension dans votre navigateur

   - Ouvrez Chrome/Firefox
   - Activez le mode développeur dans les extensions
   - Chargez l'extension non empaquetée depuis le dossier `instagram-extension`

3. Naviguez sur Instagram et utilisez les fonctionnalités en cliquant sur le bouton EzMeme

## Structure du projet

- `server.js` - Serveur principal Node.js
- `easyocr/` - Module Python pour la reconnaissance de texte
- `instagram-extension/` - Extension navigateur
- `downloads/` - Dossier où sont stockés les fichiers téléchargés
- `frames/` - Images extraites des vidéos pour l'OCR
- `ocr/` - Résultats de l'analyse OCR

## Contribution

Les contributions sont les bienvenues! N'hésitez pas à ouvrir une issue ou à soumettre une pull request.

## Licence

Ce projet est sous licence MIT.
