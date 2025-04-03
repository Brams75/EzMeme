import easyocr
from openai import OpenAI
import os
import sys
from pathlib import Path
import difflib
import json
from dotenv import load_dotenv
import argparse

# Charger les variables d'environnement depuis le fichier .env
load_dotenv()

# Récupérer la clé API depuis les variables d'environnement
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("ERREUR: Clé API OpenAI non trouvée dans le fichier .env")
    print("Veuillez définir OPENAI_API_KEY dans le fichier .env")
    sys.exit(1)

# Initialiser le client OpenAI avec la clé récupérée
client = OpenAI(api_key=api_key)

# Récupérer la configuration GPU pour EasyOCR
gpu_enabled = os.getenv('EASYOCR_GPU_ENABLED', 'True').lower() == 'true'
print(f"EasyOCR GPU enabled: {gpu_enabled}")

# Initialiser EasyOCR avec la langue française
reader = easyocr.Reader(['fr','en'], gpu=gpu_enabled)

def extract_text_from_image(image_path):
    """Extrait le texte d'une image"""
    # Lire le texte depuis l'image
    result = reader.readtext(image_path)
    
    # Concaténer le texte extrait
    return "\n".join([detection[1] for detection in result])

def are_texts_similar(text1, text2, threshold=0.7):
    """Détermine si deux textes sont similaires en utilisant la similarité de séquence."""
    similarity = difflib.SequenceMatcher(None, text1, text2).ratio()
    return similarity >= threshold

def group_similar_texts(texts, threshold=0.7):
    """Groupe les textes similaires ensemble."""
    if not texts:
        return []
        
    groups = []
    processed = [False] * len(texts)
    
    for i in range(len(texts)):
        if processed[i]:
            continue
            
        current_group = [texts[i]]
        processed[i] = True
        
        for j in range(i + 1, len(texts)):
            if not processed[j] and are_texts_similar(texts[i], texts[j], threshold):
                current_group.append(texts[j])
                processed[j] = True
                
        groups.append(current_group)
        
    return groups

def correct_text_with_chatgpt(texts):
    """Utilise ChatGPT pour corriger un groupe de textes similaires."""
    messages = [
        {"role": "system", "content": """Tu es un assistant spécialisé dans l'analyse de textes extraits par OCR.
Ta tâche est de :
1. Analyser tous les textes fournis qui sont supposés être la même phrase
2. Identifier la version la plus correcte et complète
3. Corriger les erreurs évidentes d'OCR, notamment les caractères spéciaux et accents
4. Retourner UNIQUEMENT la version la plus correcte du texte, en conservant les accents et caractères spéciaux"""},
        {"role": "user", "content": f"Voici les différentes versions du même texte extraites par OCR. Identifie la version la plus correcte et corrige-la si nécessaire, en particulier les accents et caractères spéciaux :\n\n" + "\n\n---\n\n".join(texts)}
    ]

    # Appel à l'API ChatGPT
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages,
        temperature=0.1,  # Très bas pour plus de cohérence
        max_tokens=500
    )

    return response.choices[0].message.content

def process_images(frames_dir):
    """Traite toutes les images, groupe les textes similaires et corrige chaque groupe"""
    # Utiliser le chemin fourni en argument
    image_dir = Path(frames_dir)
    print(f"Traitement des images dans le dossier : {image_dir}")
    
    if not image_dir.exists():
        print(f"Erreur : Le dossier {image_dir} n'existe pas")
        return []
    
    # Liste pour stocker tous les textes extraits avec leur frame source
    textes_extraits = []
    frames_sources = {}
    
    # Traiter chaque image
    for image_path in sorted(image_dir.glob('*.png')):
        print(f"\nTraitement de l'image : {image_path.name}")
        try:
            texte = extract_text_from_image(str(image_path))
            if texte.strip():  # N'ajouter que les textes non vides
                textes_extraits.append(texte)
                # Garder une trace de quelle frame vient de quel texte
                frames_sources[texte] = image_path.name
                print(f"Texte extrait de {image_path.name}: {texte[:50]}..." if len(texte) > 50 else f"Texte extrait: {texte}")
        except Exception as e:
            print(f"Erreur lors du traitement de {image_path.name}: {str(e)}")
    
    if not textes_extraits:
        print("Aucun texte n'a été extrait des images.")
        return []
    
    # Grouper les textes similaires
    print("\nGroupement des textes similaires...")
    grouped_texts = group_similar_texts(textes_extraits)
    print(f"{len(grouped_texts)} groupes de textes identifiés")
    
    corrected_texts = []
    
    # Traiter chaque groupe de textes
    for i, group in enumerate(grouped_texts):
        print(f"\nTraitement du groupe {i+1} ({len(group)} textes similaires)")
        
        # Afficher un exemple de texte du groupe
        sample = group[0][:50] + "..." if len(group[0]) > 50 else group[0]
        print(f"Exemple: {sample}")
        
        # Corriger le groupe de textes avec ChatGPT
        corrected = correct_text_with_chatgpt(group)
        
        # Récupérer les frames sources pour ce groupe
        source_frames = [frames_sources[text] for text in group if text in frames_sources]
        
        # Stocker le résultat - SANS extraire les hashtags qui seront gérés par le serveur
        corrected_texts.append({
            "text": corrected,
            "source_frames": source_frames,
            "is_corrected": True
        })
        
        print(f"Texte corrigé: {corrected[:50]}..." if len(corrected) > 50 else f"Texte corrigé: {corrected}")
    
    # Afficher tous les textes corrigés
    print("\n=== Textes finaux corrigés ===\n")
    for i, result in enumerate(corrected_texts):
        print(f"Texte {i+1}: {result['text']}")
        print(f"Frames sources: {', '.join(result['source_frames'])}")
        print("-" * 40)
    print("=" * 50)
    
    return corrected_texts

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Analyse OCR des images avec EasyOCR et OpenAI')
    parser.add_argument('frames_dir', help='Chemin vers le dossier contenant les frames')
    parser.add_argument('--lang', default='fra', help='Langue à utiliser pour l\'OCR')
    parser.add_argument('--gpu', default='True', help='Utiliser le GPU pour EasyOCR (True/False)')
    
    args = parser.parse_args()
    
    # Configurer l'encodage pour l'ensemble du script
    import sys
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer)
    
    # Mise à jour de la configuration GPU en fonction de l'argument passé
    gpu_flag = os.getenv('EASYOCR_GPU_ENABLED', args.gpu).lower() == 'true'
    print(f"GPU activé pour EasyOCR: {gpu_flag}")
    
    frames_dir = args.frames_dir
    results = process_images(frames_dir)
    
    # Écrire les résultats dans un fichier JSON pour que le serveur Node.js puisse les lire
    import json
    output_file = os.path.join(frames_dir, "..", "ocr", "easyocr_results.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    print(f"\nRésultats écrits dans {output_file}")
