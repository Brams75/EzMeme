import torch
import easyocr
import numpy as np
import cv2
import base64
import json
import argparse
import time
import os
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from flask_cors import CORS
from openai import OpenAI

# Charger les variables d'environnement
load_dotenv()

app = Flask(__name__)
CORS(app)  # Permettre les requêtes cross-origin

# Variables globales pour stocker les modèles préchargés
gpu_reader = None
cpu_reader = None

# Initialiser le client OpenAI
api_key = os.getenv('OPENAI_API_KEY')
if api_key:
    client = OpenAI(api_key=api_key)
else:
    client = None
    print("AVERTISSEMENT: Clé API OpenAI non définie, la correction de texte ne sera pas disponible")

def initialize_readers():
    """Initialise les lecteurs EasyOCR (GPU et CPU) et les garde en mémoire"""
    global gpu_reader, cpu_reader
    
    # Récupérer la configuration GPU depuis .env
    use_gpu = os.getenv('EASYOCR_GPU_ENABLED', 'True').lower() == 'true'
    
    print(f"CUDA disponible: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU actif: {torch.cuda.get_device_name(0)}")
    
    print("Initialisation des modèles EasyOCR (cela peut prendre quelques secondes)...")
    
    # Initialiser le modèle GPU si possible
    if use_gpu and torch.cuda.is_available():
        print("Initialisation du modèle GPU...")
        start_time = time.time()
        gpu_reader = easyocr.Reader(['fr', 'en'], 
                                   gpu=True,
                                   quantize=False,
                                   download_enabled=False,
                                   detector=True,
                                   recognizer=True,
                                   cudnn_benchmark=True)
        print(f"Modèle GPU initialisé en {time.time() - start_time:.2f}s")
    else:
        print("GPU non disponible ou désactivé")
    
    # Toujours initialiser le modèle CPU comme fallback
    print("Initialisation du modèle CPU...")
    start_time = time.time()
    cpu_reader = easyocr.Reader(['fr', 'en'], 
                               gpu=False,
                               quantize=True,  # Quantification pour CPU
                               download_enabled=False,
                               detector=True,
                               recognizer=True)
    print(f"Modèle CPU initialisé en {time.time() - start_time:.2f}s")
    
    print("Modèles EasyOCR initialisés et prêts")
    return True

def preprocess_image(image_data, scale_percent=30):
    """Prétraiter l'image pour accélérer l'OCR"""
    # Redimensionner l'image
    width = int(image_data.shape[1] * scale_percent / 100)
    height = int(image_data.shape[0] * scale_percent / 100)
    resized = cv2.resize(image_data, (width, height))
    
    # Convertir en niveaux de gris
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    
    # Améliorer le contraste pour une meilleure détection de texte
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    enhanced = clahe.apply(gray)
    
    return enhanced

def correct_text_with_chatgpt(texts):
    """Utilise ChatGPT pour corriger un groupe de textes similaires."""
    if not client:
        return "\n".join(texts) if isinstance(texts, list) else texts
    
    start_time = time.time()
    
    # Prompt plus concis pour réduire les tokens
    messages = [
        {"role": "system", "content": "Corrige les erreurs OCR et retourne uniquement la meilleure version du texte."},
        {"role": "user", "content": "\n---\n".join(texts if isinstance(texts, list) else [texts])}
    ]

    # Utiliser gpt-3.5-turbo-16k pour des réponses rapides
    response = client.chat.completions.create(
        model="gpt-3.5-turbo-16k",
        messages=messages,
        temperature=0.1,  # Très bas pour plus de cohérence
        max_tokens=200,   # Réduire pour plus de rapidité
        top_p=0.95        # Réduire la randomisation
    )
    gpt_time = time.time() - start_time
    print(f"GPT correction time: {gpt_time:.2f} seconds")

    return response.choices[0].message.content

def group_similar_texts(texts, threshold=0.7):
    """Groupe les textes similaires ensemble."""
    import difflib

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
            # Vérifier la similarité avec difflib
            similarity = difflib.SequenceMatcher(None, texts[i], texts[j]).ratio()
            if not processed[j] and similarity >= threshold:
                current_group.append(texts[j])
                processed[j] = True
                
        groups.append(current_group)
        
    return groups

@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint de vérification de l'état du service"""
    return jsonify({
        "status": "healthy",
        "gpu_available": gpu_reader is not None,
        "cpu_available": cpu_reader is not None,
        "cuda_available": torch.cuda.is_available(),
        "openai_available": client is not None
    })

@app.route('/process', methods=['POST'])
def process_image():
    """Endpoint pour traiter une image avec le modèle préchargé"""
    start_time = time.time()
    
    # Vérifier que les modèles sont chargés
    if gpu_reader is None and cpu_reader is None:
        return jsonify({"error": "Les modèles EasyOCR ne sont pas initialisés"}), 500
    
    try:
        # Récupérer les paramètres de la requête
        data = request.json
        if not data or 'image' not in data:
            return jsonify({"error": "Aucune image fournie"}), 400
        
        # Paramètres d'OCR
        use_gpu = data.get('use_gpu', True) and gpu_reader is not None
        scale_percent = data.get('scale_percent', 30)
        correct_text = data.get('correct_text', False)
        
        # Décodage de l'image Base64
        image_b64 = data['image']
        if image_b64.startswith('data:image'):
            image_b64 = image_b64.split(',')[1]
        
        # Convertir Base64 en image
        img_bytes = base64.b64decode(image_b64)
        img_array = np.frombuffer(img_bytes, np.uint8)
        image = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        
        if image is None:
            return jsonify({"error": "Image invalide"}), 400
        
        # Prétraitement de l'image
        preproc_start = time.time()
        preprocessed = preprocess_image(image, scale_percent)
        preproc_time = time.time() - preproc_start
        
        # Sélectionner le reader approprié
        reader = gpu_reader if use_gpu else cpu_reader
        
        # Paramètres OCR optimisés
        batch_size = 8 if use_gpu else 1
        canvas_size = 2048 if use_gpu else 1024
        
        # Effectuer l'OCR
        ocr_start = time.time()
        result = reader.readtext(
            preprocessed,
            detail=0,           # Récupérer uniquement le texte
            paragraph=True,     # Regrouper les textes en paragraphes
            batch_size=batch_size,
            min_size=10,        # Taille minimum des textes
            contrast_ths=0.3,   # Seuil de contraste
            adjust_contrast=0.5, # Ajustement de contraste 
            text_threshold=0.6, # Seuil de reconnaissance de texte
            link_threshold=0.3,  # Seuil de liaison
            width_ths=0.5,      # Seuil de largeur
            low_text=0.3,       # Seuil de texte faible
            canvas_size=canvas_size
        )
        ocr_time = time.time() - ocr_start
        
        # Convertir le résultat en texte
        texts = result if isinstance(result, list) else [result]
        
        # Appliquer la correction de texte si demandé
        corrected_text = None
        correction_time = 0
        
        if correct_text and client and texts:
            correction_start = time.time()
            corrected_text = correct_text_with_chatgpt(texts)
            correction_time = time.time() - correction_start
        
        # Libérer la mémoire GPU si utilisée
        if use_gpu and torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        # Construire la réponse
        response = {
            "success": True,
            "texts": texts,
            "text": "\n".join(texts) if texts else "",
            "corrected_text": corrected_text,
            "performance": {
                "preprocessing_time": preproc_time,
                "ocr_time": ocr_time,
                "correction_time": correction_time,
                "total_time": time.time() - start_time,
                "gpu_used": use_gpu
            }
        }
        
        return jsonify(response)
        
    except Exception as e:
        # En cas d'erreur, libérer la mémoire GPU
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return jsonify({"error": str(e)}), 500

@app.route('/correct-texts', methods=['POST'])
def correct_texts():
    """Endpoint pour corriger des textes avec ChatGPT"""
    if not client:
        return jsonify({"error": "OpenAI API non configurée"}), 500
    
    try:
        data = request.json
        if not data or 'texts' not in data:
            return jsonify({"error": "Aucun texte fourni"}), 400
        
        texts = data['texts']
        if not texts:
            return jsonify({"error": "Liste de textes vide"}), 400
        
        # Regrouper les textes similaires si demandé
        if data.get('group_similar', False):
            threshold = data.get('similarity_threshold', 0.7)
            grouped_texts = group_similar_texts(texts, threshold)
            
            # Corriger chaque groupe
            corrected_groups = []
            for group in grouped_texts:
                corrected = correct_text_with_chatgpt(group)
                corrected_groups.append({
                    "original_texts": group,
                    "corrected_text": corrected
                })
            
            return jsonify({
                "success": True,
                "grouped_corrections": corrected_groups
            })
        else:
            # Corriger la liste entière de textes
            corrected = correct_text_with_chatgpt(texts)
            return jsonify({
                "success": True,
                "original_texts": texts,
                "corrected_text": corrected
            })
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Service EasyOCR avec modèle préchargé")
    parser.add_argument("--port", type=int, default=5000, help="Port d'écoute")
    parser.add_argument("--host", default="127.0.0.1", help="Adresse d'écoute")
    args = parser.parse_args()
    
    # Initialiser les modèles au démarrage
    initialize_readers()
    
    # Démarrer le serveur Flask
    print(f"Démarrage du service EasyOCR sur {args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False) 