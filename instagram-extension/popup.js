document.addEventListener("DOMContentLoaded", () => {
  console.log("Popup chargé");

  // Éléments UI principaux
  const serverStatus = document.getElementById("server-status");
  const progressContainer = document.querySelector(".progress-container");
  const progressBar = document.querySelector(".progress-bar");
  const progressMessage = document.querySelector(".progress-message");

  // Initialisation des onglets, boutons et statut serveur
  setupTabs();
  setupCopyButtons();
  setupActionButtons();
  checkServerConnection();

  // Charger les données stockées au démarrage
  loadStoredData();

  // Configurer les écouteurs de messages pour les mises à jour en temps réel
  setupMessageListeners();
});

// Fonction pour configurer les onglets
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // Retirer la classe active de tous les onglets
      tabs.forEach((t) => t.classList.remove("active"));

      // Cacher tous les contenus d'onglet
      tabContents.forEach((content) => content.classList.remove("active"));

      // Activer l'onglet cliqué
      tab.classList.add("active");

      // Afficher le contenu correspondant
      const target = tab.getAttribute("data-target");
      document.getElementById(target).classList.add("active");
    });
  });
}

// Fonction pour configurer les boutons de copie
function setupCopyButtons() {
  const copyDescriptionBtn = document.getElementById("copy-description");
  const copyHashtagsBtn = document.getElementById("copy-hashtags");
  const copyOcrTextBtn = document.getElementById("copy-ocr-text");

  if (copyDescriptionBtn) {
    copyDescriptionBtn.addEventListener("click", () => {
      const description = document.getElementById("post-description");
      if (
        description &&
        description.textContent &&
        description.textContent !== "Aucune description disponible"
      ) {
        copyTextToClipboard(description.textContent).then(() =>
          showCopySuccess(copyDescriptionBtn)
        );
      }
    });
  }

  if (copyHashtagsBtn) {
    copyHashtagsBtn.addEventListener("click", () => {
      const hashtagsContainer = document.querySelector(".hashtags-container");
      if (hashtagsContainer) {
        const hashtags = Array.from(
          hashtagsContainer.querySelectorAll(".hashtag")
        )
          .map((tag) => tag.textContent)
          .join(" ");

        if (hashtags && hashtags !== "Aucun hashtag trouvé") {
          copyTextToClipboard(hashtags).then(() =>
            showCopySuccess(copyHashtagsBtn)
          );
        }
      }
    });
  }

  if (copyOcrTextBtn) {
    copyOcrTextBtn.addEventListener("click", () => {
      const textContainer = document.querySelector(".texts-container");
      if (textContainer) {
        const detectedText = Array.from(
          textContainer.querySelectorAll(".detected-text")
        )
          .map((text) => text.textContent)
          .join("\n\n");

        if (detectedText && !detectedText.includes("Aucun texte détecté")) {
          copyTextToClipboard(detectedText).then(() =>
            showCopySuccess(copyOcrTextBtn)
          );
        }
      }
    });
  }
}

// Fonction pour configurer les boutons d'action
function setupActionButtons() {
  const downloadAllBtn = document.getElementById("download-all-btn");
  const downloadVideoBtn = document.getElementById("download-video-btn");
  const downloadAudioBtn = document.getElementById("download-audio-btn");
  const extractMetadataBtn = document.getElementById("extract-metadata-btn");
  const processOcrBtn = document.getElementById("process-ocr-btn");

  // Fonction pour exécuter une action avec l'onglet actif
  async function executeAction(action, messageType, progressMessage) {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.url || !tab.url.includes("instagram.com")) {
        throw new Error(
          "Veuillez ouvrir un post Instagram avant d'utiliser cette extension"
        );
      }

      // Désactiver tous les boutons pendant l'opération
      disableButtons(true);

      // Afficher la progression
      updateProgressUI(progressMessage, 10);

      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: messageType,
            url: tab.url,
            tabId: tab.id,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response && response.error) {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          }
        );
      });
    } catch (error) {
      console.error(`Erreur lors de ${action}:`, error);
      updateProgressUI(`Erreur: ${error.message}`, 0);
      disableButtons(false);
      throw error;
    }
  }

  // Configurer le bouton "Tout télécharger"
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener("click", async () => {
      try {
        await executeAction(
          "du téléchargement complet",
          "EXTRACT_DATA",
          "Démarrage du téléchargement complet..."
        );
      } catch (error) {
        console.error("Erreur lors du téléchargement complet:", error);
      }
    });
  }

  // Configurer le bouton "Télécharger vidéo"
  if (downloadVideoBtn) {
    downloadVideoBtn.addEventListener("click", async () => {
      try {
        await executeAction(
          "du téléchargement vidéo",
          "DOWNLOAD_VIDEO",
          "Téléchargement de la vidéo..."
        );
      } catch (error) {
        console.error("Erreur lors du téléchargement vidéo:", error);
      }
    });
  }

  // Configurer le bouton "Télécharger audio"
  if (downloadAudioBtn) {
    downloadAudioBtn.addEventListener("click", async () => {
      try {
        await executeAction(
          "du téléchargement audio",
          "DOWNLOAD_AUDIO",
          "Téléchargement de l'audio..."
        );
      } catch (error) {
        console.error("Erreur lors du téléchargement audio:", error);
      }
    });
  }

  // Configurer le bouton "Extraire métadonnées"
  if (extractMetadataBtn) {
    extractMetadataBtn.addEventListener("click", async () => {
      try {
        const response = await executeAction(
          "de l'extraction des métadonnées",
          "EXTRACT_METADATA",
          "Extraction des métadonnées..."
        );

        // Mettre à jour l'UI avec les métadonnées
        if (response && response.success) {
          updateMetadataUI(response);
          updateProgressUI("Métadonnées extraites avec succès", 100);

          // Activer l'onglet de description
          const descriptionTab = document.querySelector(
            '.tab[data-target="description-tab"]'
          );
          if (descriptionTab) {
            descriptionTab.click();
          }
        }
      } catch (error) {
        console.error("Erreur lors de l'extraction des métadonnées:", error);
      } finally {
        disableButtons(false);
      }
    });
  }

  // Configurer le bouton "Traiter OCR"
  if (processOcrBtn) {
    processOcrBtn.addEventListener("click", async () => {
      try {
        const response = await executeAction(
          "du traitement OCR",
          "PROCESS_VIDEO",
          "Traitement OCR en cours..."
        );

        // Mettre à jour l'UI avec le texte OCR
        if (
          response &&
          (response.success || response.type === "OCR_COMPLETE")
        ) {
          displayOCRData(response);
          updateProgressUI("Texte extrait avec succès", 100);

          // Activer l'onglet OCR
          const ocrTab = document.querySelector('.tab[data-target="ocr-tab"]');
          if (ocrTab) {
            ocrTab.click();
          }
        }
      } catch (error) {
        console.error("Erreur lors du traitement OCR:", error);
      } finally {
        disableButtons(false);
      }
    });
  }
}

// Fonction pour charger les données stockées
function loadStoredData() {
  chrome.storage.local.get(["currentPostData", "ocrData"], (data) => {
    console.log("Données récupérées du storage:", data);

    if (data.currentPostData) {
      updateMetadataUI(data.currentPostData);
    }

    if (data.ocrData) {
      displayOCRData(data.ocrData);
    }
  });
}

// Fonction pour configurer les écouteurs de messages
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message reçu dans popup.js:", message);

    if (!message || !message.type) return;

    switch (message.type) {
      case "DOWNLOAD_STATUS":
      case "METADATA_STATUS":
      case "OCR_STATUS":
        updateProgressUI(message.status, message.progress || null);

        // Si c'est un statut de métadonnées et qu'il y a des métadonnées
        if (message.type === "METADATA_STATUS" && message.description) {
          updateMetadataUI(message);
        }

        // Si c'est un statut OCR et qu'il y a du texte
        if (message.type === "OCR_STATUS" && message.text) {
          displayOCRData({ text: message.text });
        }
        break;

      case "DOWNLOAD_ALL_STATUS":
        updateProgressUI(message.status, message.progress || null);

        if (message.complete) {
          disableButtons(false);
        }
        break;

      case "SERVER_STATUS":
        updateServerStatus(message.available);
        break;
    }

    return true;
  });

  // Écouter les changements dans le stockage local
  chrome.storage.onChanged.addListener((changes) => {
    console.log("Changements détectés dans le storage:", changes);

    if (changes.currentPostData && changes.currentPostData.newValue) {
      updateMetadataUI(changes.currentPostData.newValue);
    }

    if (changes.ocrData && changes.ocrData.newValue) {
      displayOCRData(changes.ocrData.newValue);
    }
  });
}

// Fonction pour mettre à jour l'UI des métadonnées
function updateMetadataUI(metadata) {
  const sections = [];

  // Combiner la description et les hashtags dans une seule section
  if (metadata.description || metadata.hashtags) {
    let combinedContent = "";

    // Ajouter la description si elle existe
    if (metadata.description) {
      combinedContent += metadata.description;
    }

    // Ajouter les hashtags si ils existent
    if (metadata.hashtags && metadata.hashtags.length > 0) {
      if (combinedContent) {
        combinedContent += "\n\n";
      }
      combinedContent += metadata.hashtags.join(" ");
    }

    sections.push({
      title: "Description et Hashtags",
      content: combinedContent || "Aucun contenu disponible",
    });
  }

  // Ajouter les autres sections si elles existent
  if (metadata.location) {
    sections.push({
      title: "Lieu",
      content: metadata.location,
    });
  }

  if (metadata.date) {
    sections.push({
      title: "Date",
      content: metadata.date,
    });
  }

  if (metadata.author) {
    sections.push({
      title: "Auteur",
      content: metadata.author,
    });
  }

  // Afficher la modale avec toutes les sections
  showContentModal({
    title: "Métadonnées",
    sections: sections,
  });
}

// Fonction pour afficher les données OCR
function displayOCRData(ocrData) {
  const textsContainer = document.querySelector(".texts-container");
  const copyOcrTextBtn = document.getElementById("copy-ocr-text");

  if (textsContainer) {
    // Vider le conteneur
    textsContainer.innerHTML = "";

    if (ocrData && ocrData.text && ocrData.text.trim()) {
      const textElement = document.createElement("div");
      textElement.className = "detected-text";
      textElement.textContent = ocrData.text;
      textsContainer.appendChild(textElement);

      if (copyOcrTextBtn) copyOcrTextBtn.disabled = false;
    } else {
      const noText = document.createElement("div");
      noText.className = "detected-text no-text";
      noText.textContent = "Aucun texte détecté dans cette vidéo";
      textsContainer.appendChild(noText);

      if (copyOcrTextBtn) copyOcrTextBtn.disabled = true;
    }
  }
}

// Fonction pour mettre à jour l'UI de progression
function updateProgressUI(message, progress = null) {
  const progressContainer = document.querySelector(".progress-container");
  const progressBar = document.querySelector(".progress-bar");
  const progressMessage = document.querySelector(".progress-message");

  if (progressContainer && progressBar && progressMessage) {
    progressContainer.style.display = "block";
    progressMessage.textContent = message;

    if (progress !== null) {
      progressBar.style.width = `${progress}%`;

      // Ajuster la couleur en fonction du progrès
      if (progress === 0) {
        progressBar.style.backgroundColor = "#f44336"; // Rouge pour les erreurs
      } else if (progress === 100) {
        progressBar.style.backgroundColor = "#4caf50"; // Vert pour succès
      } else {
        progressBar.style.backgroundColor = "#2196f3"; // Bleu pour en cours
      }
    }

    // Stocker la dernière mise à jour
    chrome.storage.local.set({
      lastProgressUpdate: {
        message: message,
        progress: progress,
        timestamp: Date.now(),
      },
    });
  }
}

// Fonction pour copier du texte dans le presse-papiers
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Erreur lors de la copie dans le presse-papiers:", error);
    return false;
  }
}

// Fonction pour afficher le succès de la copie
function showCopySuccess(button) {
  const originalText = button.textContent;
  button.textContent = "✓ Copié!";
  button.classList.add("success");

  setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove("success");
  }, 2000);
}

// Fonction pour vérifier la connexion au serveur
async function checkServerConnection() {
  const serverStatus = document.getElementById("server-status");

  if (!serverStatus) return;

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "CHECK_SERVER" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });

    updateServerStatus(response && response.available);
  } catch (error) {
    console.error("Erreur lors de la vérification du serveur:", error);
    updateServerStatus(false);
  }
}

// Fonction pour mettre à jour le statut du serveur
function updateServerStatus(isAvailable) {
  const serverStatus = document.getElementById("server-status");

  if (serverStatus) {
    if (isAvailable) {
      serverStatus.textContent = "Serveur connecté";
      serverStatus.className = "status-online";
      disableButtons(false);
    } else {
      serverStatus.textContent = "Serveur déconnecté";
      serverStatus.className = "status-offline";
      disableButtons(true, "Le serveur est déconnecté");
    }
  }
}

// Fonction pour activer/désactiver les boutons
function disableButtons(disabled = true, reason = "") {
  const buttons = document.querySelectorAll(
    ".action-buttons button, #download-all-btn"
  );

  buttons.forEach((button) => {
    button.disabled = disabled;

    if (disabled && reason) {
      button.setAttribute("title", reason);
    } else {
      button.removeAttribute("title");
    }
  });
}
