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
import torch  # Ajout de l'import torch pour diagnostic CUDA

# Charger les variables d'environnement depuis le fichier .env
load_dotenv()

# Variable globale pour la configuration GPU
gpu_enabled = os.getenv('EASYOCR_GPU_ENABLED', 'True').lower() == 'true'

# Diagnostic CUDA
print(f"CUDA disponible: {torch.cuda.is_available()}")
print(f"Nombre de GPUs: {torch.cuda.device_count()}")
if torch.cuda.is_available():
    print(f"GPU actif: {torch.cuda.get_device_name(0)}")

# Récupérer la clé API depuis les variables d'environnement
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("ERREUR: Clé API OpenAI non trouvée dans le fichier .env")
    print("Veuillez définir OPENAI_API_KEY dans le fichier .env")
    sys.exit(1)

# Initialiser le client OpenAI avec la clé récupérée
client = OpenAI(api_key=api_key)

# Afficher la configuration GPU
print(f"EasyOCR GPU enabled: {gpu_enabled}")

# Variable pour tracking des performances
performance_metrics = {
    'preprocessing_time': 0,
    'ocr_time': 0,
    'total_time': 0,
    'images_processed': 0,
    'unique_images': 0
}

# Initialiser EasyOCR avec la langue française
# Ajout des paramètres d'optimisation pour la détection GPU
reader = easyocr.Reader(['fr','en'], 
                        gpu=gpu_enabled,
                        download_enabled=False,    # Évite de vérifier les téléchargements à chaque fois
                        detector=True,
                        recognizer=True,
                        cudnn_benchmark=gpu_enabled # Optimisation CUDA si GPU activé
                       )

def get_image_hash(image):
    """Calcule un hash simple de l'image pour identifier les images similaires"""
    # Redimensionner l'image à une petite taille fixe
    small_img = cv2.resize(image, (32, 32))
    # Convertir en niveaux de gris
    gray_img = cv2.cvtColor(small_img, cv2.COLOR_BGR2GRAY)
    # Calculer le hash basé sur le contenu de l'image
    img_hash = hashlib.md5(gray_img.tobytes()).hexdigest()
    return img_hash

def preprocess_image(image_path, scale_percent=30):
    """Prétraite l'image en la redimensionnant pour accélérer l'OCR"""
    start_time = time.time()
    img = cv2.imread(image_path)
    if img is None:
        print(f"Erreur: Impossible de lire l'image {image_path}")
        return None
        
    # Redimensionner l'image plus agressivement (30% au lieu de 50%)
    width = int(img.shape[1] * scale_percent / 100)
    height = int(img.shape[0] * scale_percent / 100)
    resized = cv2.resize(img, (width, height))
    
    # Convertir en niveaux de gris pour accélérer l'OCR
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    
    # Améliorer le contraste pour une meilleure détection de texte
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    enhanced = clahe.apply(gray)
    
    # Mise à jour des métriques
    performance_metrics['preprocessing_time'] += time.time() - start_time
    
    return enhanced

def process_image_worker(image_path, scale_percent=30, fast_mode=True):
    """Fonction de travail pour le traitement parallèle"""
    try:
    # Initialiser EasyOCR avec la langue française pour chaque processus
    # Paramètres optimisés en fonction du mode GPU/CPU
        init_start = time.time()
        print(f"[TIMING] Début initialisation du modèle EasyOCR pour {image_path}")
    local_reader = easyocr.Reader(
        ['fr','en'], 
        gpu=gpu_enabled,
        # Optimisations spécifiques selon le mode
        quantize=not gpu_enabled,  # Quantification seulement en mode CPU
        recognizer=True,
        download_enabled=False,    # Évite de vérifier les téléchargements à chaque fois
        detector=True,
        cudnn_benchmark=gpu_enabled # Optimisation CUDA si GPU activé
    )
        init_time = time.time() - init_start
        print(f"[TIMING] Initialisation du modèle EasyOCR terminée en {init_time:.2f}s")
        
    start_time = time.time()
    
    # Prétraiter l'image pour accélérer l'OCR
        preproc_start = time.time()
    preprocessed_img = preprocess_image(image_path, scale_percent=scale_percent)
        preproc_time = time.time() - preproc_start
        print(f"[TIMING] Prétraitement de l'image {image_path} en {preproc_time:.2f}s")
    
    if preprocessed_img is not None:
            # Paramètres optimisés pour GPU ou CPU selon le mode activé
            batch_size = 8 if gpu_enabled else 1
            canvas_size = 2048 if gpu_enabled else 1024
            
            readtext_start = time.time()
            result = local_reader.readtext(
                preprocessed_img,
                detail=0,           # Récupérer uniquement le texte
                paragraph=True,     # Regrouper les textes en paragraphes
                batch_size=batch_size,
                min_size=10,        # Taille minimum des textes (valeur moins stricte)
                contrast_ths=0.3,   # Seuil de contraste
                adjust_contrast=0.5, # Ajustement de contraste 
                text_threshold=0.6, # Seuil de reconnaissance de texte plus élevé
                link_threshold=0.3,  # Seuil de liaison
                width_ths=0.5,      # Seuil de largeur moins strict
                low_text=0.3,       # Seuil de texte faible moins strict
                canvas_size=canvas_size    # Taille du canvas adaptée au matériel
            )
            readtext_time = time.time() - readtext_start
            print(f"[TIMING] Lecture OCR de l'image {image_path} en {readtext_time:.2f}s")
            
            # Convertir le résultat en texte
            text = "\n".join(result) if isinstance(result, list) else str(result)
            
            # Libérer la mémoire immédiatement
            del preprocessed_img
    else:
        # Fallback sur l'image originale en cas d'erreur
            # Ajuster le batch_size selon le mode GPU/CPU
            batch_size = 8 if gpu_enabled else 1
            readtext_start = time.time()
            result = local_reader.readtext(
                image_path,
                detail=0,
                paragraph=True,
                batch_size=batch_size,
                text_threshold=0.6
            )
            readtext_time = time.time() - readtext_start
            print(f"[TIMING] Lecture OCR (fallback) de l'image {image_path} en {readtext_time:.2f}s")
            
            text = "\n".join(result) if isinstance(result, list) else str(result)
        
    ocr_time = time.time() - start_time
    
        # Libérer la mémoire explicitement après l'OCR
        if gpu_enabled and torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        # Libérer la mémoire du reader
        del local_reader
        
        # Force garbage collection
        import gc
        gc.collect()
        
        return text, str(image_path), ocr_time
    except Exception as e:
        print(f"Erreur dans process_image_worker pour {image_path}: {str(e)}")
        # Retourner une valeur par défaut en cas d'erreur pour éviter de bloquer le processus
        return f"ERREUR: {str(e)}", str(image_path), 0

# Déplacer la fonction calculate_hash en dehors pour qu'elle soit picklable
def calculate_hash(img_path):
    """Fonction pour calculer le hash d'une image."""
    img = cv2.imread(str(img_path))
    if img is not None:
        img_hash = get_image_hash(img)
        return img_path, img_hash
    return img_path, None

def process_images(frames_dir, max_images=40, scale_percent=30, fast_mode=True, use_gpu=True):
    """Traite toutes les images, groupe les textes similaires et corrige chaque groupe"""
    # Utiliser le chemin fourni en argument
    image_dir = Path(frames_dir)
    print(f"[TIMING] Démarrage du traitement à {time.strftime('%H:%M:%S')}")
    print(f"Traitement des images dans le dossier : {image_dir}")
    print(f"Mode rapide: {fast_mode}, Redimensionnement: {scale_percent}%, GPU: {use_gpu}")
    
    total_start_time = time.time()
    
    if not image_dir.exists():
        print(f"Erreur : Le dossier {image_dir} n'existe pas")
        return []
    
    # Liste pour stocker tous les textes extraits avec leur frame source
    textes_extraits = []
    frames_sources = {}
    
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
    
    # Déterminer le nombre optimal de processus pour le traitement
    num_images = len(image_paths)
    use_hash_detection = num_images > 10  # Désactiver le hachage pour les petits lots (< 10 images)
    
    # Ajuster le nombre de processus en fonction des cœurs CPU disponibles
    num_cores = multiprocessing.cpu_count()
    print(f"Nombre de cœurs CPU disponibles: {num_cores}")
    
    if use_gpu:
        # En mode GPU, limiter à 2 processus pour éviter de saturer la mémoire GPU
        max_workers = min(2, num_images)
        print(f"Mode GPU: utilisation de {max_workers} processus")
    else:
        # En mode CPU, adapter selon le nombre de cœurs (utiliser 75% des cœurs disponibles)
        max_workers = max(1, min(num_images, int(num_cores * 0.75)))
        print(f"Mode CPU: utilisation de {max_workers} processus sur {num_cores} cœurs disponibles")
    
    # *** OPTIMISATION 1: INITIALISER LE MODÈLE UNE SEULE FOIS ***
    print("[TIMING] Initialisation unique du modèle EasyOCR...")
    init_start = time.time()
    
    # Initialiser EasyOCR avec les paramètres optimisés
    easyocr_reader = easyocr.Reader(
        ['fr','en'], 
        gpu=use_gpu,
        quantize=not use_gpu,
        recognizer=True,
        download_enabled=False,
        detector=True,
        cudnn_benchmark=use_gpu
    )
    
    init_time = time.time() - init_start
    print(f"[TIMING] Initialisation du modèle terminée en {init_time:.2f}s")
    
    # Paramètres communs pour l'OCR
    batch_size = 8 if use_gpu else 1
    canvas_size = 2048 if use_gpu else 1024
    
    # Options spéciales pour accélérer le traitement
    if fast_mode:
        print("Mode rapide activé: paramètres OCR optimisés pour la vitesse")
    
    # *** OPTIMISATION 2: TRAITEMENT SANS HACHAGE POUR LES PETITS LOTS ***
    # Traiter les images directement puisque le lot est petit
    print(f"[TIMING] Début traitement OCR à {time.time() - total_start_time:.2f}s")
    
    # Traiter les images séquentiellement avec le même modèle EasyOCR
    for i, img_path in enumerate(image_paths):
        try:
            process_start = time.time()
            
            # Prétraiter l'image
            preproc_start = time.time()
            preprocessed_img = preprocess_image(str(img_path), scale_percent=scale_percent)
            preproc_time = time.time() - preproc_start
            print(f"[TIMING] Prétraitement image {i+1}: {preproc_time:.2f}s")
            
            if preprocessed_img is not None:
                # Effectuer l'OCR avec le modèle préchargé
                ocr_start = time.time()
                result = easyocr_reader.readtext(
                    preprocessed_img,
                    detail=0,
                    paragraph=True,
                    batch_size=batch_size,
                    min_size=10,
                    contrast_ths=0.3,
                    adjust_contrast=0.5,
                    text_threshold=0.6,
                    link_threshold=0.3,
                    width_ths=0.5,
                    low_text=0.3,
                    canvas_size=canvas_size
                )
                ocr_time = time.time() - ocr_start
                print(f"[TIMING] OCR image {i+1}: {ocr_time:.2f}s")
                
                # Convertir le résultat en texte
                texte = "\n".join(result) if isinstance(result, list) else str(result)
                
                # Libérer la mémoire
                del preprocessed_img
            else:
                # Fallback sur l'image originale
                ocr_start = time.time()
                result = easyocr_reader.readtext(
                    str(img_path),
                    detail=0,
                    paragraph=True,
                    batch_size=batch_size,
                    text_threshold=0.6
                )
                ocr_time = time.time() - ocr_start
                print(f"[TIMING] OCR fallback image {i+1}: {ocr_time:.2f}s")
                
                texte = "\n".join(result) if isinstance(result, list) else str(result)
            
            process_total = time.time() - process_start
            print(f"[TIMING] Image {i+1}/{len(image_paths)}: OCR={ocr_time:.2f}s, Total={process_total:.2f}s")
            
            # Mise à jour des métriques
            performance_metrics['ocr_time'] += ocr_time
            performance_metrics['preprocessing_time'] += preproc_time
            performance_metrics['images_processed'] += 1
            
            if texte.strip():  # Ne garder que les textes non vides
                textes_extraits.append(texte)
                frames_sources[texte] = img_path.name
                print(f"Texte extrait de l'image {i+1}: {texte[:100]}..." if len(texte) > 100 else f"Texte extrait: {texte}")
                    else:
                print(f"Aucun texte extrait de l'image {i+1}")
                        
            except Exception as e:
            print(f"Erreur lors du traitement de {img_path}: {str(e)}")
        
        # Libérer la mémoire GPU explicitement après chaque image
        if use_gpu and torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        # Force garbage collection
            import gc
            gc.collect()
    
    # Libérer le modèle EasyOCR après utilisation
    del easyocr_reader
    
    ocr_total_time = time.time() - ocr_start_time
    print(f"[TIMING] Traitement OCR terminé en {ocr_total_time:.2f}s")
    
    # Regrouper les textes similaires
    print("\nRegroupement des textes similaires...")
    grouping_start = time.time()
    
    if textes_extraits:
        # Utiliser un seuil de similitude (0.7 est un bon compromis)
        groupes_textes = group_similar_texts(textes_extraits, threshold=0.7)
        grouping_time = time.time() - grouping_start
        print(f"[TIMING] Regroupement terminé en {grouping_time:.2f}s - {len(groupes_textes)} groupes de textes identifiés")
        
        # Correction des groupes avec ChatGPT
        gpt_start_time = time.time()
        results = []
        
        for i, groupe in enumerate(groupes_textes):
            group_start_time = time.time()
            print(f"\nTraitement du groupe {i+1}/{len(groupes_textes)}")
            
            if len(groupe) > 1:
                # Pour les groupes de textes similaires, utiliser ChatGPT pour obtenir la meilleure version
                print(f"Correction de {len(groupe)} textes similaires avec ChatGPT")
                try:
                    corrected_text = correct_text_with_chatgpt(groupe)
                    
                    # Trouver l'image source représentative (prendre celle du premier texte du groupe)
                    source_image = frames_sources.get(groupe[0], "inconnu")
                    
                    print(f"Texte corrigé: {corrected_text[:100]}..." if len(corrected_text) > 100 else f"Texte corrigé: {corrected_text}")
                    results.append({
                        "text": corrected_text,
                        "text_type": "corrected",
                        "image": source_image,
                        "confidence": 0.95,  # Confiance élevée car corrigé par IA
                        "original_texts": groupe,
                        "is_significant": True
                    })
                except Exception as e:
                    print(f"Erreur lors de la correction avec ChatGPT: {str(e)}")
                    
                    # En cas d'erreur, utiliser le premier texte du groupe
                    source_image = frames_sources.get(groupe[0], "inconnu")
                    results.append({
                        "text": groupe[0],
                        "text_type": "raw",
                        "image": source_image,
                        "confidence": 0.8,  # Confiance plus faible car non corrigé
                        "is_significant": True
                    })
            else:
                # Pour les textes uniques, les ajouter tels quels
                text = groupe[0]
                source_image = frames_sources.get(text, "inconnu")
                
                # Filtrer les textes non significatifs (trop courts ou sans sens)
                is_significant = len(text.strip()) > 3  # Plus de 3 caractères
                
                results.append({
                    "text": text,
                    "text_type": "raw",
                    "image": source_image,
                    "confidence": 0.7,  # Confiance moyenne pour les textes non corrigés
                    "is_significant": is_significant
                })
            
            group_time = time.time() - group_start_time
            print(f"[TIMING] Groupe {i+1} traité en {group_time:.2f}s")
        
        gpt_total_time = time.time() - gpt_start_time
        print(f"[TIMING] Correction GPT terminée en {gpt_total_time:.2f}s")
    else:
        print("Aucun texte extrait, pas de correction ChatGPT nécessaire")
        results = []
        
    total_time = time.time() - total_start_time
    
    # Mettre à jour les métriques finales
    performance_metrics['total_time'] = total_time
    performance_metrics['unique_images'] = len(image_paths)
    
    # Afficher les statistiques
    print("\n--- Statistiques de performance ---")
    print(f"Mode GPU: {use_gpu}")
    print(f"Images totales: {len(image_paths)}")
    print(f"Temps d'initialisation du modèle: {init_time:.2f}s")
    print(f"Temps de prétraitement: {performance_metrics['preprocessing_time']:.2f}s")
    print(f"Temps OCR: {performance_metrics['ocr_time']:.2f}s")
    if 'grouping_time' in locals():
        print(f"Temps de regroupement: {grouping_time:.2f}s")
    if 'gpt_total_time' in locals():
        print(f"Temps de correction GPT: {gpt_total_time:.2f}s")
    print(f"Temps total: {performance_metrics['total_time']:.2f}s")
    if performance_metrics['images_processed'] > 0:
        print(f"Moyenne par image: {performance_metrics['ocr_time']/performance_metrics['images_processed']:.2f}s")
    
    print("\n[TIMING] Répartition du temps:")
    print(f"- Initialisation: {init_time:.2f}s ({(init_time/total_time)*100:.1f}%)")
    print(f"- OCR: {ocr_total_time:.2f}s ({(ocr_total_time/total_time)*100:.1f}%)")
    if 'grouping_time' in locals():
        print(f"- Regroupement: {grouping_time:.2f}s ({(grouping_time/total_time)*100:.1f}%)")
    if 'gpt_total_time' in locals():
        print(f"- Correction GPT: {gpt_total_time:.2f}s ({(gpt_total_time/total_time)*100:.1f}%)")
    print("-----------------------------------")
    
    return results

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
    
    # Prompt plus concis pour réduire les tokens
    messages = [
        {"role": "system", "content": "Corrige les erreurs OCR et retourne uniquement la meilleure version du texte."},
        {"role": "user", "content": "\n---\n".join(texts)}
    ]

    print(f"[TIMING] Début appel API ChatGPT pour {len(texts)} textes")
    print(f"[TIMING] Nombre de tokens d'entrée approximatif: {len(' '.join(texts)) // 4}")
    
    # Utiliser gpt-3.5-turbo-instruct pour des réponses plus rapides
    api_start = time.time()
    
    # Options: gpt-3.5-turbo (équilibré), gpt-3.5-turbo-instruct (plus rapide)
    model = "gpt-3.5-turbo"  # Essayer avec le modèle standard qui est souvent plus rapide
    
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.1,  # Très bas pour plus de cohérence
        max_tokens=100,   # Réduire pour plus de rapidité
        top_p=0.95        # Réduire la randomisation
    )
    
    api_time = time.time() - api_start
    gpt_time = time.time() - start_time
    print(f"[TIMING] API ChatGPT ({model}): appel={api_time:.2f}s, total={gpt_time:.2f}s")

    return response.choices[0].message.content

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Analyse OCR des images avec EasyOCR et OpenAI')
    parser.add_argument('frames_dir', help='Chemin vers le dossier contenant les frames')
    parser.add_argument('--lang', default='fra', help='Langue à utiliser pour l\'OCR')
    parser.add_argument('--gpu', default='True', help='Utiliser le GPU pour EasyOCR (True/False)')
    parser.add_argument('--scale', type=int, default=30, help='Pourcentage de redimensionnement des images (30 = 30%)')
    parser.add_argument('--max-images', type=int, default=40, help='Nombre maximum d\'images à traiter (0 = toutes)')
    parser.add_argument('--fast', action='store_true', help='Mode rapide avec paramètres optimisés')
    
    args = parser.parse_args()
    
    # Configurer l'encodage pour l'ensemble du script
    import sys
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer)
    
    try:
    # Mise à jour de la configuration GPU en fonction de l'argument passé
        # Utiliser une approche différente: créer une nouvelle variable au lieu de modifier gpu_enabled
        use_gpu = args.gpu.lower() == 'true'
        print(f"GPU activé pour EasyOCR: {use_gpu}")
    
    frames_dir = args.frames_dir
        
        # Utiliser la variable locale au lieu de la variable globale
        # On passe l'état GPU en paramètre à la fonction process_images
        results = process_images(frames_dir, max_images=args.max_images, scale_percent=args.scale, fast_mode=args.fast, use_gpu=use_gpu)
    
    # Créer le dossier ocr s'il n'existe pas
    output_dir = os.path.join(os.path.dirname(frames_dir), "ocr")
    os.makedirs(output_dir, exist_ok=True)
    
    # Écrire les résultats dans un fichier JSON pour que le serveur Node.js puisse les lire
    output_file = os.path.join(output_dir, "easyocr_results.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    print(f"\nRésultats écrits dans {output_file}")
        
    except Exception as e:
        print(f"Erreur fatale dans le script principal: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Nettoyage final de la mémoire GPU
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        # Forcer le garbage collection
        import gc
        gc.collect()
