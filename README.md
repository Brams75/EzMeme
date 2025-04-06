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

### Architecture technique détaillée

L'application repose sur deux services principaux :

1. **Serveur principal Node.js** (server.js) :

   - Fonctionne sur le port 3000 par défaut
   - Gère les requêtes HTTP, le téléchargement de contenu, l'extraction des frames
   - Communique avec le service EasyOCR

2. **Service EasyOCR Python** (easyocr/service.py) :
   - Fonctionne sur le port 5000 par défaut
   - Gère l'OCR via des modèles préchargés (GPU et CPU)
   - Intègre l'API OpenAI pour la correction de texte

Les deux services sont indépendants et communiquent via HTTP. Le serveur principal démarre automatiquement le service EasyOCR au démarrage si celui-ci n'est pas déjà en cours d'exécution.

## Installation

### Prérequis

- **Node.js** (v14+)
- **Python** (v3.8+)
- **FFmpeg** (installation automatique via npm)
- **Conda** ou autre gestionnaire d'environnements Python
- **Clé API OpenAI** (pour la correction de texte)
- **Chrome** ou **Firefox** pour l'extension
- **CUDA** (optionnel mais recommandé pour accélérer l'OCR)

#### Versions exactes testées

- Node.js: v16.14.0
- Python: v3.8.13
- FFmpeg: v5.1.2
- Conda: v4.13.0
- Chrome: v110+
- Firefox: v100+

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

**Important** : Sur Windows, si vous utilisez CUDA, vous pourriez rencontrer des erreurs liées à OpenMP. Ajoutez alors la variable d'environnement suivante :

```
set KMP_DUPLICATE_LIB_OK=TRUE
```

#### 4. Configuration des variables d'environnement

Copiez le fichier d'exemple de configuration `.env-example` vers `.env` :

```bash
cp .env-example .env
```

Puis modifiez le fichier `.env` avec vos paramètres :

```
# Configuration de l'API OpenAI
OPENAI_API_KEY=votre-clé-api-openai

# Configuration de l'API EasyOCR
EASYOCR_GPU_ENABLED=true  # Mettre false si pas de GPU compatible CUDA
CUDA_VISIBLE_DEVICES=0    # Modifier si plusieurs GPU
EASYOCR_SERVICE_PORT=5000
EASYOCR_SERVICE_HOST=127.0.0.1

# Autres paramètres
DEBUG_MODE=False
```

#### 5. Création des répertoires nécessaires

```bash
mkdir -p downloads frames ocr
```

#### 6. Installation de l'extension navigateur

1. Ouvrez Chrome ou Firefox
2. Accédez aux extensions (`chrome://extensions` ou `about:addons`)
3. Activez le mode développeur
4. Cliquez sur "Charger l'extension non empaquetée" / "Charger un module temporaire"
5. Sélectionnez le dossier `instagram-extension` du projet

## Utilisation

### Démarrer le serveur

```bash
node server.js
```

**Important** : Le premier démarrage peut prendre jusqu'à 2 minutes car le système doit :

1. Démarrer le service EasyOCR Python
2. Précharger les modèles de reconnaissance OCR volumineux

Un message "Service EasyOCR démarré et prêt" indiquera que le système est opérationnel.

### Ports utilisés

- **Serveur principal** : Port 3000 par défaut (configurable)
- **Service EasyOCR** : Port 5000 par défaut (configurable dans .env)

Assurez-vous que ces ports sont disponibles ou modifiez-les dans les configurations.

### Utiliser l'extension

1. Naviguez vers un post Instagram (vidéo/réel)
2. Cliquez sur l'icône de l'extension EzMeme dans la barre d'outils
3. Utilisez les boutons pour :
   - Télécharger la vidéo
   - Extraire l'audio
   - Extraire les métadonnées (description/hashtags)
   - Analyser le texte dans la vidéo (OCR)
   - Tout traiter en une seule opération

### Configuration de l'OCR

Vous pouvez ajuster plusieurs paramètres pour l'OCR dans le fichier `easyocr/service.py` :

- **Taille de redimensionnement** : Définie à 30% par défaut (ajustable via l'API)
- **Seuil de détection de texte** : 0.6 par défaut (plus bas = plus sensible)
- **Taille de batch** : 8 pour GPU, 1 pour CPU

## Structure du projet

```
EzMeme/
│
├── server.js                    # Serveur principal Node.js
├── .env                         # Variables d'environnement
├── .env-example                 # Exemple de configuration
│
├── downloads/                   # Répertoire de téléchargements
├── frames/                      # Images extraites des vidéos
├── ocr/                         # Résultats de l'analyse OCR
│
├── easyocr/                     # Module Python OCR
│   ├── service.py               # Service API OCR
│   ├── index.py                 # Script alternatif OCR
│   └── requirements.txt         # Dépendances Python
│
└── instagram-extension/         # Extension navigateur
    ├── manifest.json            # Configuration de l'extension
    ├── popup.html               # Interface utilisateur
    ├── popup.js                 # Logique de l'interface
    ├── content.js               # Script intégré aux pages Instagram
    ├── modal.js                 # Gestion des fenêtres modales
    ├── background.js            # Service worker en arrière-plan
    ├── package.json             # Dépendances de l'extension
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

### Exemple de requête

```bash
curl -X POST http://localhost:3000/direct-download-video \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.instagram.com/reel/XYZ123/"}'
```

### Exemple de réponse

```json
{
  "success": true,
  "message": "Vidéo téléchargée avec succès",
  "data": {
    "videoUrl": "http://localhost:3000/download/video/instagram_XYZ123.mp4",
    "metadata": {
      "duration": "00:15",
      "size": "2.4MB"
    }
  }
}
```

## API du service EasyOCR

Le service Python expose les endpoints suivants :

| Endpoint         | Méthode | Description                               |
| ---------------- | ------- | ----------------------------------------- |
| `/health`        | GET     | Vérifie l'état du service                 |
| `/process`       | POST    | Traite une image avec OCR                 |
| `/correct-texts` | POST    | Corrige un ensemble de textes avec OpenAI |

## Fonctionnement détaillé du processus OCR

1. **Extraction des frames** : FFmpeg extrait 1 image par seconde de la vidéo
2. **Déduplication** : Les images similaires sont détectées via hashing pour éviter les traitements redondants
3. **Prétraitement** : Redimensionnement et optimisation des images
4. **OCR parallèle** : Traitement simultané des images avec EasyOCR
5. **Regroupement** : Les textes similaires détectés dans différentes frames sont groupés
6. **Correction IA** : OpenAI GPT-3.5 corrige les erreurs et améliore la qualité du texte extrait
7. **Filtrage** : Élimination des résultats non significatifs ou trop courts

## Performances et optimisation

- **Support GPU** : Accélération matérielle pour EasyOCR si disponible
- **Traitement parallèle** : Utilisation de workers pour traiter plusieurs images simultanément
- **Mise en cache** : Les résultats sont mis en cache pour éviter les traitements redondants
- **Streaming** : Utilisation de streams Node.js pour gérer efficacement les gros fichiers

### Optimisation des performances OCR

1. **Préchargement des modèles** : Les modèles sont chargés au démarrage du service
2. **Double mode GPU/CPU** : Fallback automatique vers CPU si le GPU n'est pas disponible
3. **Redimensionnement adaptatif** : Les images sont redimensionnées à 30% par défaut
4. **Parallélisation** : Traitement de plusieurs images simultanément

## Dépannage

### Problèmes courants

1. **Le serveur ne démarre pas**

   - Vérifiez que les ports 3000 et 5000 sont disponibles
   - Assurez-vous que Node.js est correctement installé
   - Vérifiez les logs dans la console

2. **L'OCR ne fonctionne pas**

   - Vérifiez que l'environnement Conda `ezmeme` est activé
   - Vérifiez que toutes les dépendances Python sont installées
   - Assurez-vous que la clé API OpenAI est valide
   - Sur Windows, vérifiez la variable `KMP_DUPLICATE_LIB_OK=TRUE`

3. **Service EasyOCR lent au démarrage**

   - C'est normal, le premier chargement des modèles prend 1-2 minutes
   - Les lancements suivants seront plus rapides tant que le service reste actif
   - Vous pouvez préchauffer le service séparément : `python easyocr/service.py`

4. **L'extension ne se connecte pas au serveur**

   - Vérifiez que le serveur est en cours d'exécution
   - Vérifiez les paramètres CORS dans le navigateur
   - Vérifiez les permissions dans manifest.json

5. **Problèmes de CUDA**
   - Vérifiez l'installation de CUDA (version recommandée: 11.x)
   - Essayez de désactiver le GPU en mettant `EASYOCR_GPU_ENABLED=false` dans .env

### Logs et diagnostics

Les logs sont disponibles dans les emplacements suivants :

- **Serveur principal** : Console Node.js
- **Service EasyOCR** : Console Python du service
- **Extension** : Console développeur du navigateur (F12 > Onglet Console)

Pour activer les logs détaillés :

1. Définissez `DEBUG_MODE=True` dans le fichier `.env`
2. Redémarrez les services

## Développement avancé

### Architecture des modèles OCR

EasyOCR utilise deux réseaux de neurones :

1. **Détecteur** : Localise les zones de texte (CRAFT)
2. **Reconnaisseur** : Convertit l'image en texte (CRNN)

### Modèles de langage

Par défaut, l'OCR est configuré pour le français et l'anglais. Pour ajouter d'autres langues, modifiez les paramètres du reader dans `easyocr/service.py` :

```python
reader = easyocr.Reader(['fr', 'en', 'es'], # Ajoutez d'autres langues ici
                       gpu=True,
                       quantize=False)
```

### Correction avancée avec OpenAI

Le système utilise l'API OpenAI GPT-3.5-Turbo pour corriger les textes extraits. Vous pouvez personnaliser :

- Le prompt système (défini dans service.py)
- Le modèle (gpt-3.5-turbo-16k par défaut)
- Les paramètres de génération (température, top_p, etc.)

## Maintenir le projet

### Dépendances critiques

Le projet dépend de plusieurs bibliothèques majeures :

1. **EasyOCR** : OCR multilingue basé sur PyTorch
2. **Puppeteer** : Automatisation de Chrome pour le téléchargement
3. **FFmpeg** : Traitement des médias et extraction de frames
4. **OpenAI** : Correction de texte

La mise à jour de ces dépendances peut nécessiter des tests approfondis.

### Mise à jour de l'extension

Pour mettre à jour l'extension :

1. Modifiez les fichiers dans le dossier `instagram-extension/`
2. Incrémentez la version dans `manifest.json`
3. Rechargez l'extension dans le navigateur

### Compatibilité avec Instagram

Instagram modifie fréquemment son interface et sa structure HTML. Si l'extension cesse de fonctionner :

1. Examinez les logs de la console du navigateur
2. Vérifiez si les sélecteurs CSS dans `content.js` doivent être mis à jour
3. Testez avec différentes types de posts (reels, stories, posts normaux)

## Contribuer au projet

Les contributions sont les bienvenues ! Voici comment procéder :

1. Forkez le dépôt
2. Créez une branche pour votre fonctionnalité (`git checkout -b feature/ma-fonctionnalite`)
3. Committez vos changements (`git commit -m 'Ajout de ma fonctionnalite'`)
4. Poussez vers la branche (`git push origin feature/ma-fonctionnalite`)
5. Ouvrez une Pull Request

### Style de code et conventions

- **JavaScript** : Style ESM, avec import/export
- **Python** : PEP 8, avec docstrings
- **Commentaires** : Français de préférence

## Licence

Ce projet est sous licence MIT.

## Contact

Pour toute question ou suggestion, n'hésitez pas à ouvrir une issue sur GitHub.
