// Styles pour la modale
const modalStyles = `
  .modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  }

  .modal-content {
    background-color: #ffffff;
    border-radius: 12px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
  }

  .modal-header {
    padding: 16px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #1f2937;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #4b5563;
    padding: 0 8px;
    line-height: 1;
  }

  .modal-body {
    padding: 16px;
  }

  .modal-section {
    background-color: #f3f4f6;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  }

  .modal-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e5e7eb;
  }

  .modal-section-title {
    font-size: 16px;
    font-weight: 600;
    color: #1f2937;
    margin: 0;
  }

  .copy-button {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    background-color: #ffffff;
    color: #4b5563;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
  }

  .copy-button:hover {
    background-color: #f3f4f6;
    border-color: #2563eb;
    color: #2563eb;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .copy-button:active {
    transform: translateY(0);
  }

  .copy-button.copied {
    background-color: #dcfce7;
    border-color: #22c55e;
    color: #16a34a;
  }

  .copy-button svg {
    width: 14px;
    height: 14px;
  }

  .modal-section-content {
    font-size: 14px;
    line-height: 1.6;
    color: #4b5563;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .modal-section-content:empty::before {
    content: "Aucun contenu disponible";
    color: #4b5563;
    font-style: italic;
  }

  body.modal-open {
    overflow: hidden;
  }
`;

// Fonction pour afficher une modal avec le contenu
export function showContentModal(options = { title: "", sections: [] }) {
  // Ajouter la classe modal-open au body
  document.body.classList.add("modal-open");

  // Créer la modale
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">${options.title}</h2>
        <button class="modal-close">&times;</button>
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
          section.style.transition = "box-shadow 0.3s ease";
          section.style.boxShadow = "0 0 0 2px rgba(34, 197, 94, 0.2)";

          setTimeout(() => {
            button.classList.remove("copied");
            button.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              Copier
            `;
            section.style.boxShadow = "";
          }, 2000);
        });
      }
    });
  });
}
