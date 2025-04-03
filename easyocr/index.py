import easyocr
from openai import OpenAI
import os
import sys
from pathlib import Path
import difflib
import json
from dotenv import load_dotenv
import argparse
import time
import multiprocessing
from concurrent.futures import ProcessPoolExecutor, as_completed
import cv2
import numpy as np
import hashlib

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

def get_image_hash(image):
    """Calcule un hash simple de l'image pour identifier les images similaires"""
    # Redimensionner l'image à une petite taille fixe
    small_img = cv2.resize(image, (32, 32))
    # Convertir en niveaux de gris
    gray_img = cv2.cvtColor(small_img, cv2.COLOR_BGR2GRAY)
    # Calculer le hash basé sur le contenu de l'image
    img_hash = hashlib.md5(gray_img.tobytes()).hexdigest()
    return img_hash

def preprocess_image(image_path, scale_percent=50):
    """Prétraite l'image en la redimensionnant pour accélérer l'OCR"""
    img = cv2.imread(image_path)
    if img is None:
        print(f"Erreur: Impossible de lire l'image {image_path}")
        return None
        
    # Redimensionner l'image
    width = int(img.shape[1] * scale_percent / 100)
    height = int(img.shape[0] * scale_percent / 100)
    resized = cv2.resize(img, (width, height))
    
    # Version simple: retourner l'image redimensionnée sans traitement additionnel
    # qui pourrait perturber la détection de texte
    return resized
    
    # Le code ci-dessous est commenté car il peut interférer avec l'OCR
    # Optimisation supplémentaire: améliorer le contraste pour la détection de texte
    # Convertir en niveaux de gris
    # gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    
    # Appliquer un flou gaussien pour réduire le bruit
    # blur = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Améliorer le contraste avec CLAHE (Contrast Limited Adaptive Histogram Equalization)
    # clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    # enhanced = clahe.apply(blur)
    
    # Reconvertir en image couleur pour compatibilité avec EasyOCR
    # result = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
    
    # return result

def extract_text_from_image(image_path):
    """Extrait le texte d'une image"""
    start_time = time.time()
    # Lire le texte depuis l'image
    result = reader.readtext(image_path)
    ocr_time = time.time() - start_time
    print(f"OCR extraction time for {image_path}: {ocr_time:.2f} seconds")
    
    # Concaténer le texte extrait
    text = "\n".join([detection[1] for detection in result])
    return text, image_path, ocr_time

def process_image_worker(image_path, scale_percent=60, fast_mode=False):
    """Fonction de travail pour le traitement parallèle"""
    # Initialiser EasyOCR avec la langue française pour chaque processus
    # En mode CPU, réduire la complexité du modèle et activer la quantification
    local_reader = easyocr.Reader(
        ['fr','en'], 
        gpu=gpu_enabled, 
        quantize=True,  # Activer la quantification pour accélérer sur CPU
        recognizer=True
    )
    start_time = time.time()
    
    # Prétraiter l'image pour accélérer l'OCR
    preprocessed_img = preprocess_image(image_path, scale_percent=scale_percent)
    
    if preprocessed_img is not None:
        # En mode rapide, utiliser des paramètres plus optimisés
        if fast_mode:
            result = local_reader.readtext(
                preprocessed_img,
                detail=0,           # Récupérer uniquement le texte
                paragraph=True,     # Regrouper les textes en paragraphes
                batch_size=1,       # Utiliser un batch_size de 1 sur CPU
                min_size=10,        # Taille minimum des textes (valeur moins stricte)
                contrast_ths=0.3,   # Seuil de contraste
                adjust_contrast=0.5, # Ajustement de contraste 
                text_threshold=0.5, # Seuil de reconnaissance de texte
                link_threshold=0.3,  # Seuil de liaison
                width_ths=0.5,      # Seuil de largeur moins strict
                low_text=0.3,       # Seuil de texte faible moins strict
                canvas_size=1024    # Taille réduite du canvas pour CPU
            )
            # Convertir le résultat en texte
            text = "\n".join(result) if isinstance(result, list) else str(result)
        else:
            # Mode normal
            result = local_reader.readtext(preprocessed_img)
            text = "\n".join([detection[1] for detection in result])
    else:
        # Fallback sur l'image originale en cas d'erreur
        if fast_mode:
            result = local_reader.readtext(
                image_path,
                detail=0,
                paragraph=True,
                batch_size=4,
                text_threshold=0.5,
                link_threshold=0.3
            )
            text = "\n".join(result) if isinstance(result, list) else str(result)
        else:
            result = local_reader.readtext(image_path)
            text = "\n".join([detection[1] for detection in result])
        
    ocr_time = time.time() - start_time
    
    return text, str(image_path), ocr_time

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
    start_time = time.time()
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
    gpt_time = time.time() - start_time
    print(f"GPT correction time for {len(texts)} texts: {gpt_time:.2f} seconds")

    return response.choices[0].message.content

def process_images(frames_dir, max_images=None, scale_percent=60, fast_mode=False):
    """Traite toutes les images, groupe les textes similaires et corrige chaque groupe"""
    # Utiliser le chemin fourni en argument
    image_dir = Path(frames_dir)
    print(f"Traitement des images dans le dossier : {image_dir}")
    print(f"Mode rapide: {fast_mode}, Redimensionnement: {scale_percent}%, GPU: {gpu_enabled}")
    
    total_start_time = time.time()
    
    if not image_dir.exists():
        print(f"Erreur : Le dossier {image_dir} n'existe pas")
        return []
    
    # Liste pour stocker tous les textes extraits avec leur frame source
    textes_extraits = []
    frames_sources = {}
    processed_hashes = {}  # Cache d'images déjà traitées
    
    # Mesurer le temps d'extraction OCR total
    ocr_start_time = time.time()
    
    # Récupérer toutes les images à traiter
    image_paths = sorted(image_dir.glob('*.png'))
    
    # Limiter le nombre d'images à traiter si spécifié
    if max_images and max_images > 0 and len(image_paths) > max_images:
        print(f"Limitation à {max_images} images sur {len(image_paths)} disponibles")
        # Prendre les images à intervalle régulier pour couvrir toute la vidéo
        if len(image_paths) > 1:
            step = len(image_paths) // max_images
            image_paths = image_paths[::step][:max_images]
        else:
            image_paths = image_paths[:max_images]
    
    print(f"Traitement de {len(image_paths)} images")
    
    # Prétraiter toutes les images pour détecter les doublons
    print("Analyse préliminaire des images pour détecter les doublons...")
    unique_images = []
    image_to_hash_map = {}
    
    for img_path in image_paths:
        img = cv2.imread(str(img_path))
        if img is not None:
            img_hash = get_image_hash(img)
            
            if img_hash not in image_to_hash_map:
                image_to_hash_map[img_hash] = []
                unique_images.append(img_path)
            
            image_to_hash_map[img_hash].append(img_path)
    
    print(f"Trouvé {len(unique_images)} images uniques sur {len(image_paths)} images totales")
    
    # Déterminer le nombre de processus à utiliser
    # Sur CPU, utiliser moins de workers pour éviter la surcharge
    max_workers = max(1, min(4, multiprocessing.cpu_count() // 2))
    print(f"Utilisation de {max_workers} processus pour le traitement OCR parallèle")
    
    # Adapter le chunk_size pour les traitements
    chunk_size = max(1, len(unique_images) // max_workers)
    
    # Traiter uniquement les images uniques en parallèle
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        # Soumettre toutes les tâches
        futures = {executor.submit(process_image_worker, str(img_path), scale_percent, fast_mode): img_path for img_path in unique_images}
        
        # Récupérer les résultats au fur et à mesure qu'ils sont complétés
        for future in as_completed(futures):
            img_path = futures[future]
            try:
                texte, path, ocr_time = future.result()
                print(f"\nTraitement de l'image : {img_path.name} - {ocr_time:.2f} seconds")
                
                if texte.strip():  # N'ajouter que les textes non vides
                    textes_extraits.append(texte)
                    
                    # Associer toutes les images similaires à ce texte
                    img = cv2.imread(str(img_path))
                    if img is not None:
                        img_hash = get_image_hash(img)
                        similar_images = image_to_hash_map.get(img_hash, [img_path])
                        
                        # Ajouter toutes les frames sources pour ce texte
                        for similar_img in similar_images:
                            frames_sources[texte] = similar_img.name
                    else:
                        # Si on ne peut pas lire l'image, utiliser juste celle-ci
                        frames_sources[texte] = img_path.name
                        
                    print(f"Texte extrait de {img_path.name}: {texte[:50]}..." if len(texte) > 50 else f"Texte extrait: {texte}")
            except Exception as e:
                print(f"Erreur lors du traitement de {img_path.name}: {str(e)}")
                
            # Libérer la mémoire explicitement après chaque image
            import gc
            gc.collect()
    
    ocr_total_time = time.time() - ocr_start_time
    print(f"\nTemps total d'extraction OCR: {ocr_total_time:.2f} seconds")
    
    if not textes_extraits:
        print("Aucun texte n'a été extrait des images.")
        return []
    
    # Toujours poursuivre avec la correction ChatGPT, même en mode rapide
    # Grouper les textes similaires
    print("\nGroupement des textes similaires...")
    group_start_time = time.time()
    grouped_texts = group_similar_texts(textes_extraits)
    group_time = time.time() - group_start_time
    print(f"{len(grouped_texts)} groupes de textes identifiés en {group_time:.2f} seconds")
    
    corrected_texts = []
    
    # Mesurer le temps de correction GPT total
    gpt_start_time = time.time()
    
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
    
    gpt_total_time = time.time() - gpt_start_time
    print(f"\nTemps total de correction GPT: {gpt_total_time:.2f} seconds")
    
    # Afficher tous les textes corrigés
    print("\n=== Textes finaux corrigés ===\n")
    for i, result in enumerate(corrected_texts):
        print(f"Texte {i+1}: {result['text']}")
        print(f"Frames sources: {', '.join(result['source_frames'])}")
        print("-" * 40)
    
    total_time = time.time() - total_start_time
    print("=" * 50)
    print(f"RÉSUMÉ DES PERFORMANCES:")
    print(f"Temps total de traitement: {total_time:.2f} seconds")
    print(f"Temps d'extraction OCR: {ocr_total_time:.2f} seconds ({ocr_total_time/total_time*100:.1f}%)")
    print(f"Temps de groupement: {group_time:.2f} seconds ({group_time/total_time*100:.1f}%)")
    print(f"Temps de correction GPT: {gpt_total_time:.2f} seconds ({gpt_total_time/total_time*100:.1f}%)")
    print("=" * 50)
    
    return corrected_texts

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Analyse OCR des images avec EasyOCR et OpenAI')
    parser.add_argument('frames_dir', help='Chemin vers le dossier contenant les frames')
    parser.add_argument('--lang', default='fra', help='Langue à utiliser pour l\'OCR')
    parser.add_argument('--gpu', default='True', help='Utiliser le GPU pour EasyOCR (True/False)')
    parser.add_argument('--scale', type=int, default=60, help='Pourcentage de redimensionnement des images (50 = 50%)')
    parser.add_argument('--max-images', type=int, default=0, help='Nombre maximum d\'images à traiter (0 = toutes)')
    parser.add_argument('--fast', action='store_true', help='Mode rapide avec paramètres optimisés')
    
    args = parser.parse_args()
    
    # Configurer l'encodage pour l'ensemble du script
    import sys
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer)
    
    # Mise à jour de la configuration GPU en fonction de l'argument passé
    gpu_flag = os.getenv('EASYOCR_GPU_ENABLED', args.gpu).lower() == 'true'
    print(f"GPU activé pour EasyOCR: {gpu_flag}")
    
    frames_dir = args.frames_dir
    results = process_images(frames_dir, max_images=args.max_images, scale_percent=args.scale, fast_mode=args.fast)
    
    # Écrire les résultats dans un fichier JSON pour que le serveur Node.js puisse les lire
    import json
    output_file = os.path.join(frames_dir, "..", "ocr", "easyocr_results.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    print(f"\nRésultats écrits dans {output_file}")
