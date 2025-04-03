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
