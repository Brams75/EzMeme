// Fonction pour afficher une modal avec le contenu
export function showContentModal(options = { title: "", sections: [] }) {
  // Ajouter la classe modal-open au body
  document.body.classList.add("modal-open");

  // Créer la modale
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <style>
      :root {
        --primary-color: #3b82f6;
        --primary-hover: #2563eb;
        --success-color: #22c55e;
        --error-color: #ef4444;
        --text-primary: #1e293b;
        --text-secondary: #64748b;
        --bg-primary: #ffffff;
        --bg-secondary: #f8fafc;
        --border-color: #e2e8f0;
        --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
        --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07);
        --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.07), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        --accent-gradient: linear-gradient(135deg, #3b82f6, #8b5cf6);
      }
      
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(3px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      }
      
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .modal-content {
        background-color: var(--bg-primary);
        border-radius: 20px;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: var(--shadow-lg), 0 0 0 1px rgba(0, 0, 0, 0.02);
        animation: slideIn 0.3s ease-out;
        border: 1px solid var(--border-color);
      }
      
      .modal-header {
        padding: 18px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        border-bottom: 1px solid var(--border-color);
      }
      
      .modal-title {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        letter-spacing: -0.025em;
      }
      
      .modal-close {
        background: none;
        border: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        transition: all 0.2s;
      }
      
      .modal-close:hover {
        background-color: var(--bg-secondary);
        color: var(--text-primary);
      }
      
      .modal-close svg {
        width: 18px;
        height: 18px;
      }
      
      .modal-body {
        padding: 24px;
      }
      
      .modal-section {
        background-color: var(--bg-secondary);
        border-radius: 12px;
        padding: 18px;
        margin-bottom: 18px;
        box-shadow: var(--shadow-sm);
        border: 1px solid var(--border-color);
        transition: all 0.3s ease;
      }
      
      .modal-section:last-child {
        margin-bottom: 0;
      }
      
      .modal-section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border-color);
      }
      
      .modal-section-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.01em;
      }
      
      .copy-button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .copy-button:hover {
        background-color: var(--primary-color);
        border-color: var(--primary-color);
        color: white;
      }
      
      .copy-button svg {
        width: 14px;
        height: 14px;
      }
      
      .copy-button.copied {
        background-color: var(--success-color);
        border-color: var(--success-color);
        color: white;
      }
      
      .modal-section-content {
        font-size: 14px;
        line-height: 1.7;
        color: var(--text-secondary);
        white-space: pre-wrap;
        word-break: break-word;
      }
      
      .modal-section-content:empty::before {
        content: "Aucun contenu disponible";
        color: var(--text-secondary);
        font-style: italic;
        opacity: 0.7;
      }
      
      /* Styles spécifiques aux hashtags */
      .hashtags-container {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      
      .hashtag {
        background: rgba(59, 130, 246, 0.1);
        color: var(--primary-color);
        padding: 6px 14px;
        border-radius: 50px;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }
      
      .hashtag:hover {
        background: rgba(59, 130, 246, 0.15);
        transform: translateY(-1px);
      }
      
      /* Animation pour le retour visuel */
      @keyframes pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4);
        }
        70% {
          box-shadow: 0 0 0 10px rgba(34, 197, 94, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
        }
      }
      
      /* Styles pour les tableaux de texte détecté */
      .texts-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .detected-text {
        padding: 10px 14px;
        background-color: var(--bg-primary);
        border-radius: 8px;
        border-left: 3px solid var(--primary-color);
      }
      
      /* Style pour mettre en évidence le succès */
      .highlight-success {
        animation: pulse 1.5s;
      }
      
      /* Personnalisation de la barre de défilement */
      .modal-content::-webkit-scrollbar {
        width: 8px;
      }
      
      .modal-content::-webkit-scrollbar-track {
        background: var(--bg-primary);
        border-radius: 20px;
      }
      
      .modal-content::-webkit-scrollbar-thumb {
        background-color: var(--border-color);
        border-radius: 20px;
        border: 2px solid var(--bg-primary);
      }
      
      .modal-content::-webkit-scrollbar-thumb:hover {
        background-color: #cbd5e1;
      }
      
      body.modal-open {
        overflow: hidden;
      }
    </style>
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">${options.title}</h2>
        <button class="modal-close">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        ${options.sections
          .map(
            (section) => `
          <div class="modal-section">
            <div class="modal-section-header">
              <h3 class="modal-section-title">${section.title}</h3>
              <button class="copy-button">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copier
              </button>
            </div>
            <div class="modal-section-content">${section.content}</div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;

  // Ajouter la modale au body
  document.body.appendChild(modal);

  // Gérer la fermeture de la modale
  const closeButton = modal.querySelector(".modal-close");
  closeButton.addEventListener("click", () => {
    document.body.removeChild(modal);
    document.body.classList.remove("modal-open");
  });

  // Gérer le clic en dehors de la modale
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
      document.body.classList.remove("modal-open");
    }
  });

  // Configurer les boutons de copie
  const copyButtons = modal.querySelectorAll(".copy-button");
  copyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const content = button
        .closest(".modal-section")
        .querySelector(".modal-section-content");
      const text = content.textContent;

      if (text && text !== "Aucun contenu disponible") {
        navigator.clipboard.writeText(text).then(() => {
          button.classList.add("copied");
          button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Copié !
          `;

          // Effet de succès avec animation
          const section = button.closest(".modal-section");
          section.classList.add("highlight-success");

          setTimeout(() => {
            button.classList.remove("copied");
            button.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              Copier
            `;
            section.classList.remove("highlight-success");
          }, 2000);
        });
      }
    });
  });
}
