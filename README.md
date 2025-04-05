# EzMeme - Extracteur intelligent de contenu Instagram

EzMeme est une application complète qui permet de télécharger, analyser et extraire des informations depuis les posts Instagram. Elle combine une extension navigateur avec un serveur backend puissant qui offre des fonctionnalités avancées d'OCR (reconnaissance optique de caractères) et d'IA pour extraire le texte des vidéos Instagram.

## Fonctionnalités

### Principales fonctionnalités

- **Téléchargement de contenu Instagram**
  - Vidéos et Stories au format MP4
  - Extraction audio au format MP3
  - Téléchargement en un clic depuis l'extension navigateur
- **Extraction de métadonnées**
  - Description des posts
  - Hashtags utilisés
- **Reconnaissance de texte avancée (OCR)**
  - Extraction des textes présents dans les vidéos Instagram
  - Correction intelligente des textes extraits avec OpenAI GPT
  - Regroupement des textes similaires pour éliminer les doublons
- **Interface utilisateur intuitive**
  - Extension navigateur intégrée à Instagram
  - Affichage des résultats en temps réel
  - Possibilité de copier les résultats dans le presse-papier

## Architecture système

EzMeme utilise une architecture client-serveur avec 3 composants principaux :

1. **Extension navigateur Chrome/Firefox** : Interface utilisateur qui s'intègre à Instagram.
2. **Serveur Node.js** : API backend qui coordonne les traitements et expose les endpoints.
3. **Module OCR Python** : Moteur de reconnaissance de texte basé sur EasyOCR et OpenAI.

### Flux de travail

1. L'utilisateur visite un post Instagram et active l'extension.
2. L'extension envoie une requête au serveur avec l'URL du post.
3. Le serveur télécharge la vidéo et l'audio à l'aide de Puppeteer et FFmpeg.
4. Le serveur extrait les frames de la vidéo (1 par seconde).
5. Le module Python analyse les frames avec EasyOCR pour détecter le texte.
6. L'IA (OpenAI) corrige et améliore les textes extraits.
7. Les résultats sont renvoyés à l'extension pour affichage.

## Installation

### Prérequis

- **Node.js** (v14+)
- **Python** (v3.8+)
- **FFmpeg** (installation automatique via npm)
- **Conda** ou autre gestionnaire d'environnements Python
- **Clé API OpenAI** (pour la correction de texte)
- **Chrome** ou **Firefox** pour l'extension

### Étapes d'installation

#### 1. Cloner le dépôt

```bash
git clone https://github.com/votre-username/EzMeme.git
cd EzMeme
```

#### 2. Installation des dépendances Node.js

```bash
npm install
```

#### 3. Configuration de l'environnement Python avec Conda

```bash
conda create -n ezmeme python=3.8
conda activate ezmeme
pip install -r easyocr/requirements.txt
```

#### 4. Configuration des variables d'environnement

Créez un fichier `.env` à la racine du projet avec le contenu suivant :

```
OPENAI_API_KEY=votre-clé-api-openai
DEBUG_MODE=False
EASYOCR_GPU_ENABLED=True
```

Modifiez la valeur de `EASYOCR_GPU_ENABLED` en fonction de votre matériel (mettez `False` si vous n'avez pas de GPU compatible CUDA).

#### 5. Installation de l'extension navigateur

1. Ouvrez Chrome ou Firefox
2. Accédez aux extensions (`chrome://extensions` ou `about:addons`)
3. Activez le mode développeur
4. Cliquez sur "Charger l'extension non empaquetée" / "Charger un module temporaire"
5. Sélectionnez le dossier `instagram-extension` du projet

## Utilisation

### Démarrer le serveur

```bash
npm start
```

Le serveur démarrera sur le port 3000 (par défaut). Vous pouvez modifier le port dans le fichier `.env`.

### Utiliser l'extension

1. Naviguez vers un post Instagram (vidéo/réel)
2. Cliquez sur l'icône de l'extension EzMeme dans la barre d'outils
3. Utilisez les boutons pour :
   - Télécharger la vidéo
   - Extraire l'audio
   - Extraire les métadonnées (description/hashtags)
   - Analyser le texte dans la vidéo (OCR)
   - Tout traiter en une seule opération

## Structure du projet

```
EzMeme/
│
├── server.js                    # Serveur principal Node.js
├── main.js                      # Point d'entrée de l'application
├── .env                         # Variables d'environnement
│
├── downloads/                   # Répertoire de téléchargements
├── frames/                      # Images extraites des vidéos
├── ocr/                         # Résultats de l'analyse OCR
│
├── easyocr/                     # Module Python OCR
│   ├── index.py                 # Script principal OCR
│   └── requirements.txt         # Dépendances Python
│
└── instagram-extension/         # Extension navigateur
    ├── manifest.json            # Configuration de l'extension
    ├── popup.html               # Interface utilisateur
    ├── popup.js                 # Logique de l'interface
    ├── background.js            # Service worker en arrière-plan
    ├── content.js               # Script intégré aux pages Instagram
    └── icons/                   # Icônes de l'extension
```

## API du serveur

Le serveur expose plusieurs endpoints REST :

| Endpoint                    | Méthode | Description                                                              |
| --------------------------- | ------- | ------------------------------------------------------------------------ |
| `/ping`                     | GET     | Vérifie si le serveur est en ligne                                       |
| `/process-all`              | POST    | Traite toutes les actions en une fois (téléchargement, métadonnées, OCR) |
| `/direct-download-video`    | POST    | Télécharge uniquement la vidéo                                           |
| `/direct-download-audio`    | POST    | Extrait uniquement l'audio                                               |
| `/direct-extract-metadata`  | POST    | Extrait uniquement les métadonnées                                       |
| `/direct-process-ocr`       | POST    | Effectue uniquement l'analyse OCR                                        |
| `/download-all`             | POST    | Télécharge la vidéo et l'audio simultanément                             |
| `/download/:type/:filename` | GET     | Récupère un fichier téléchargé (vidéo/audio)                             |

Tous les endpoints POST acceptent un objet JSON avec une propriété `url` contenant l'URL Instagram à traiter.

## Fonctionnement détaillé du processus OCR

1. **Extraction des frames** : FFmpeg extrait 1 image par seconde de la vidéo
2. **Déduplication** : Les images similaires sont détectées via hashing pour éviter les traitements redondants
3. **Prétraitement** : Redimensionnement et optimisation des images
4. **OCR parallèle** : Traitement simultané des images avec EasyOCR
5. **Regroupement** : Les textes similaires détectés dans différentes frames sont groupés
6. **Correction IA** : OpenAI GPT-3.5 corrige les erreurs et améliore la qualité du texte extrait
7. **Filtrage** : Élimination des résultats non significatifs ou trop courts

## Gestion des fichiers temporaires

Le système gère automatiquement plusieurs types de fichiers temporaires :

- **Fichiers téléchargés** : Nettoyage automatique après 24 heures
- **Frames extraites** : Nettoyées au début de chaque nouvelle analyse
- **Fichiers de logs** : Rotation automatique (limite de 5 fichiers)
- **Scripts batch** : Supprimés après utilisation

## Performances et optimisation

- **Support GPU** : Accélération matérielle pour EasyOCR si disponible
- **Traitement parallèle** : Utilisation de workers pour traiter plusieurs images simultanément
- **Mise en cache** : Les résultats sont mis en cache pour éviter les traitements redondants
- **Streaming** : Utilisation de streams Node.js pour gérer efficacement les gros fichiers

## Dépannage

### Problèmes courants

1. **Le serveur ne démarre pas**

   - Vérifiez que le port 3000 est disponible
   - Assurez-vous que Node.js est correctement installé

2. **L'OCR ne fonctionne pas**

   - Vérifiez que l'environnement Conda `ezmeme` est activé
   - Vérifiez que toutes les dépendances Python sont installées
   - Assurez-vous que la clé API OpenAI est valide

3. **L'extension ne se connecte pas au serveur**
   - Vérifiez que le serveur est en cours d'exécution
   - Vérifiez les paramètres CORS dans le navigateur

### Logs

Les logs sont disponibles dans les emplacements suivants :

- **Serveur** : Console Node.js
- **OCR** : Fichiers dans le dossier `ocr/`
- **Extension** : Console développeur du navigateur (F12 > Onglet Console)

## Contribuer au projet

Les contributions sont les bienvenues ! Voici comment procéder :

1. Forkez le dépôt
2. Créez une branche pour votre fonctionnalité (`git checkout -b feature/ma-fonctionnalite`)
3. Committez vos changements (`git commit -m 'Ajout de ma fonctionnalité'`)
4. Poussez vers la branche (`git push origin feature/ma-fonctionnalite`)
5. Ouvrez une Pull Request

## Licence

Ce projet est sous licence MIT.

## Contact

Pour toute question ou suggestion, n'hésitez pas à ouvrir une issue sur GitHub.
