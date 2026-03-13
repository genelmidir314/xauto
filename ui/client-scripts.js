function renderScheduleSettingsScriptBody() {
  return `
      function setScheduleMessage(text, kind) {
        const message = document.getElementById("scheduleSettingsMessage");
        if (!message) return;
        message.className = "message show " + (kind || "info");
        message.textContent = text;
      }

      document.addEventListener("submit", async (event) => {
        const form = event.target;
        if (!form || form.id !== "scheduleSettingsForm") return;

        event.preventDefault();
        const submit = qs("[data-schedule-submit]");
        const fields = qsa("input", form);
        const body = {
          activeStartHour: Number(qs("#scheduleStartHour", form)?.value),
          activeEndHour: Number(qs("#scheduleEndHour", form)?.value),
          minPostIntervalMinutes: Number(qs("#scheduleIntervalMinutes", form)?.value),
        };

        if (submit) submit.disabled = true;
        fields.forEach((field) => {
          field.disabled = true;
        });

        try {
          const result = await sendJson("/schedule-settings", body);
          if (!result.ok) throw new Error(result.error || "schedule update failed");

          const summary = qs("[data-schedule-summary]");
          if (summary && result.scheduleSettings) {
            summary.textContent =
              result.scheduleSettings.activeWindowText +
              " · " +
              result.scheduleSettings.minPostIntervalMinutes +
              " dk";
          }

          const dailyLimit = qs("[data-schedule-daily-limit]");
          if (dailyLimit && result.scheduleSettings) {
            dailyLimit.textContent =
              "gunluk kapasite: " + result.scheduleSettings.dailyLimit;
          }

          setScheduleMessage(
            (result.summary || "Schedule guncellendi") +
              " · " +
              (result.rescheduledCount || 0) +
              " siradaki kayitlar yeniden siralandi. Sayfa yenileniyor...",
            "success"
          );
          setTimeout(() => location.reload(), 1200);
        } catch (error) {
          setScheduleMessage(error.message || "Schedule guncellemesi basarisiz.", "error");
          if (submit) submit.disabled = false;
          fields.forEach((field) => {
            field.disabled = false;
          });
        }
      });
  `;
}

function renderSourceManagementScriptBody() {
  return `
      function setSourceMessage(text, kind) {
        const message = document.getElementById("sourceMessage");
        if (!message) return;
        message.className = "message show " + (kind || "info");
        message.textContent = text;
      }

      function syncSourceRow(row, data) {
        if (!row || !data) return;
        const tier = qs('[data-source-field="tier"]', row);
        const category = qs('[data-source-field="category"]', row);
        const active = qs('[data-source-field="active"]', row);
        const nextCheck = qs("[data-source-next-check]", row);
        const lastCheck = qs("[data-source-last-check]", row);

        if (tier && data.tier !== undefined) tier.value = String(data.tier);
        if (category && data.category !== undefined) category.value = data.category || "";
        if (active && data.active !== undefined) active.checked = !!data.active;
        if (nextCheck && data.next_check_at) {
          nextCheck.textContent = new Date(data.next_check_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
        }
        if (lastCheck && data.last_checked_at) {
          lastCheck.textContent = new Date(data.last_checked_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
        }
      }

      document.addEventListener("click", async (event) => {
        const button = event.target.closest('button[data-action="save-source"]');
        if (!button) return;

        const row = button.closest("[data-source-id]");
        if (!row) return;
        const id = row.dataset.sourceId;
        const tier = Number(qs('[data-source-field="tier"]', row)?.value || 2);
        const category = qs('[data-source-field="category"]', row)?.value || "";
        const active = !!qs('[data-source-field="active"]', row)?.checked;

        button.disabled = true;
        try {
          const result = await sendJson("/sources/" + id + "/save", {
            tier,
            category,
            active,
          });
          if (!result.ok) throw new Error(result.error || "source save failed");
          setSourceMessage("Kaynak guncellendi. Sayfa yenileniyor...", "success");
          setTimeout(() => location.reload(), 800);
        } catch (error) {
          setSourceMessage(error.message || "Kaynak guncellemesi basarisiz.", "error");
          button.disabled = false;
        }
      });

      document.addEventListener("click", async (event) => {
        const button = event.target.closest('button[data-action="check-source-now"]');
        if (!button) return;

        const row = button.closest("[data-source-id]");
        if (!row) return;
        const id = row.dataset.sourceId;

        button.disabled = true;
        try {
          const result = await sendJson("/sources/" + id + "/check-now", {});
          if (!result.ok) throw new Error(result.error || "source check-now failed");
          syncSourceRow(row, result.row);
          setSourceMessage("Kaynak bir sonraki collector turu icin hemen due yapildi.", "success");
        } catch (error) {
          setSourceMessage(error.message || "Check now basarisiz.", "error");
        } finally {
          button.disabled = false;
        }
      });

      document.addEventListener("click", async (event) => {
        const removeFailedBtn = event.target.closest('[data-action="remove-failed-sources"]');
        if (removeFailedBtn) {
          if (!confirm("resolve_status='failed' olan tum kaynaklar silinecek. Emin misiniz?")) return;
          removeFailedBtn.disabled = true;
          try {
            const r = await sendJson("/sources/remove-failed", {});
            if (!r.ok) throw new Error(r.error || "Basarisiz");
            setSourceMessage((r.deletedCount ?? 0) + " failed kaynak silindi. Sayfa yenileniyor...", "success");
            setTimeout(() => location.reload(), 800);
          } catch (e) {
            setSourceMessage(e.message || "Hata", "error");
            removeFailedBtn.disabled = false;
          }
          return;
        }

        const button = event.target.closest('button[data-action="delete-source"]');
        if (!button) return;
        if (!confirm("Bu kaynak silinsin mi?")) return;

        const row = button.closest("[data-source-id]");
        if (!row) return;
        const id = row.dataset.sourceId;

        button.disabled = true;
        try {
          const result = await sendJson("/sources/" + id + "/delete", {});
          if (!result.ok) throw new Error(result.error || "source delete failed");
          row.remove();
          setSourceMessage("Kaynak silindi.", "success");
        } catch (error) {
          setSourceMessage(error.message || "Kaynak silme basarisiz.", "error");
          button.disabled = false;
        }
      });

      document.addEventListener("submit", async (event) => {
        const form = event.target;
        if (!form || form.id !== "sourceAddForm") return;

        event.preventDefault();
        const submit = qs("[data-source-submit]");
        const fields = qsa("input, select", form);
        const body = {
          handle: qs("#sourceHandle", form)?.value || "",
          tier: Number(qs("#sourceTier", form)?.value || 2),
          category: qs("#sourceCategory", form)?.value || "",
        };

        if (submit) submit.disabled = true;
        fields.forEach((field) => {
          field.disabled = true;
        });

        try {
          const result = await sendJson("/sources", body);
          if (!result.ok) throw new Error(result.error || "source add failed");
          setSourceMessage(
            "Kaynak eklendi. X user id collector sirasinda lazy resolve edilecek. Sayfa yenileniyor...",
            "success"
          );
          setTimeout(() => location.reload(), 800);
        } catch (error) {
          setSourceMessage(error.message || "Kaynak ekleme basarisiz.", "error");
          if (submit) submit.disabled = false;
          fields.forEach((field) => {
            field.disabled = false;
          });
        }
      });
  `;
}

function renderInboxClientScript(currentStatus, currentQueueView = "all") {
  return `
  <script>
    (() => {
      const currentStatus = ${JSON.stringify(currentStatus)};
      const currentQueueView = ${JSON.stringify(currentQueueView)};

      function qs(selector, root = document) {
        return root.querySelector(selector);
      }

      function qsa(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
      }

      function getCard(el) {
        return el.closest(".draftCard");
      }

      function payloadFor(card) {
        const useCommentEl = qs('[data-field="use-comment"]', card);
        return {
          comment_tr: qs('[data-field="comment"]', card)?.value ?? "",
          translation_tr: qs('[data-field="translation"]', card)?.value ?? "",
          use_comment: useCommentEl ? useCommentEl.checked : true,
        };
      }

      function getPreviewText(card) {
        const payload = payloadFor(card);
        const useComment = payload.use_comment !== false;
        const comment = useComment ? payload.comment_tr.trim() : "";
        const translation = payload.translation_tr.trim();
        const formatKey = card.dataset.formatKey || "";
        const xUrl = (card.dataset.xUrl || "").trim();
        if (formatKey === "comment_translation_source_link") {
          return [comment, translation, xUrl].filter(Boolean).join("\\n\\n");
        }
        if (comment && translation) return comment + "\\n\\n" + translation;
        return comment || translation || "";
      }

      function setMessage(card, text, kind) {
        const message = qs(".message", card);
        if (!message) return;
        message.className = "message show " + (kind || "info");
        message.textContent = text;
      }

      function setLoading(card, loading) {
        qsa("button[data-action]", card).forEach((button) => {
          button.disabled = loading;
        });
        card.dataset.loading = loading ? "true" : "false";
      }

      function updatePreview(card) {
        const preview = getPreviewText(card);
        const previewEl = qs("[data-preview]", card);
        const charEl = qs("[data-char-count]", card);
        const limitSensitive = qsa("[data-requires-fit]", card);

        if (previewEl) previewEl.textContent = preview;
        if (charEl) {
          charEl.textContent = preview.length + " / 280";
          charEl.classList.toggle("over", preview.length > 280);
        }

        limitSensitive.forEach((button) => {
          button.disabled = card.dataset.loading === "true" || preview.length > 280;
        });
      }

      const queueStatusDisplay = { waiting: "beklemede", processing: "paylasiliyor", done: "tamamlandi", failed: "hata" };
      function fmtQueueStatus(s) { return queueStatusDisplay[s] || s; }

      function syncCardMeta(card, nextStatus, options = {}) {
        const statusPill = qs("[data-status-pill]", card);
        const nextStatusText = nextStatus || card.dataset.status || "";
        if (statusPill) {
          statusPill.className = "pill " + nextStatusText;
          statusPill.textContent = nextStatusText;
        }
        if (nextStatus) {
          card.dataset.status = nextStatus;
        }

        if (options.inQueue !== undefined) {
          card.dataset.inQueue = options.inQueue ? "true" : "false";
          const queuePill = qs("[data-queue-pill]", card);
          if (queuePill) {
            queuePill.hidden = !options.inQueue;
            if (options.inQueue) {
              queuePill.className = "pill " + (options.queueStatus || "waiting");
              const text = qs("[data-queue-status-text]", queuePill);
              if (text) text.textContent = fmtQueueStatus(options.queueStatus || "waiting");
            }
          }
          if (!options.inQueue) {
            const scheduledBox = qs("[data-scheduled-box]", card);
            if (scheduledBox) scheduledBox.hidden = true;
          }
        }

        if (options.scheduledAtText) {
          const box = qs("[data-scheduled-box]", card);
          if (box) {
            box.hidden = false;
            const text = qs("[data-scheduled-text]", box);
            if (text) text.textContent = options.scheduledAtText;
          }
        }
      }

      function matchesCurrentView(nextStatus, inQueue) {
        if (!nextStatus || nextStatus !== currentStatus) return false;
        if (currentStatus !== "approved") return true;
        return !!inQueue;
      }

      function hideCardIfNeeded(card, nextStatus) {
        const inQueue = card.dataset.inQueue === "true";
        if (matchesCurrentView(nextStatus, inQueue)) return;
        card.remove();
        const remaining = qsa(".draftCard").length;
        const emptyState = document.getElementById("inboxEmptyState");
        if (remaining === 0 && emptyState) {
          emptyState.classList.remove("hidden");
        }
      }

      async function sendJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        return response.json();
      }

      async function handleAction(button) {
        const card = getCard(button);
        if (!card) return;
        const id = card.dataset.id;
        const action = button.dataset.action;

        if (action === "reject" && !confirm("Bu draft rejected yapilsin mi?")) return;
        if (action === "postNow" && !confirm("Bu draft hemen paylasilsin mi?")) return;
        if (action === "cancelQueue" && !confirm("Bu sira kaydi iptal edilsin mi? Sonrakiler yeniden schedule edilecek.")) return;

        setLoading(card, true);
        try {
          let result = null;
          if (action === "save") {
            result = await sendJson("/drafts/" + id + "/save", payloadFor(card));
            if (!result.ok) throw new Error(result.error || "save failed");
            setMessage(card, "Kaydedildi.", "success");
          } else if (action === "approve") {
            result = await sendJson("/drafts/" + id + "/approve-and-queue", payloadFor(card));
            if (!result.ok) throw new Error(result.error || "approve failed");
            syncCardMeta(card, "approved", {
              inQueue: true,
              queueStatus: result.queueStatus || "waiting",
              scheduledAtText: result.scheduledAtText || "",
            });
            setMessage(
              card,
              result.alreadyQueued
                ? "Zaten sirada."
                : "Siraya eklendi" + (result.scheduledAtText ? " · " + result.scheduledAtText : ""),
              "success"
            );
            hideCardIfNeeded(card, "approved");
          } else if (action === "reject") {
            result = await sendJson("/drafts/" + id + "/status", { status: "rejected" });
            if (!result.ok) throw new Error(result.error || "reject failed");
            syncCardMeta(card, "rejected", { inQueue: false });
            setMessage(card, "Rejected.", "success");
            hideCardIfNeeded(card, "rejected");
          } else if (action === "postNow") {
            result = await sendJson("/drafts/" + id + "/post-now", payloadFor(card));
            if (!result.ok) throw new Error(result.error || "post-now failed");
            syncCardMeta(card, "posted", { inQueue: false });
            setMessage(
              card,
              "Paylasildi" +
                (result.mediaAttached ? " · medya eklendi" : " · text-only") +
                (result.xPostId ? " · x_post_id=" + result.xPostId : ""),
              "success"
            );
            hideCardIfNeeded(card, "posted");
          } else if (action === "cancelQueue") {
            const queueId = card.dataset.queueId || button.dataset.queueId;
            if (!queueId) throw new Error("Sira ID bulunamadi");
            result = await sendJson("/queue/" + queueId + "/cancel", {});
            if (!result.ok) throw new Error(result.error || "cancel failed");
            setMessage(
              card,
              "Sira kaydi iptal edildi." +
                (result.rescheduledCount > 0
                  ? " " + result.rescheduledCount + " post yeniden schedule edildi."
                  : ""),
              "success"
            );
            location.reload();
          } else if (action === "retryQueue") {
            const queueId = card.dataset.queueId || button.dataset.queueId;
            if (!queueId) throw new Error("Sira ID bulunamadi");
            result = await sendJson("/queue/" + queueId + "/retry", {});
            if (!result.ok) throw new Error(result.error || "Yeniden siraya alma basarisiz");
            setMessage(card, "Yeniden siraya alindi. Poster worker kisa sure icinde deneyecek.", "success");
            location.reload();
          } else if (action === "regenerate-comment") {
            result = await sendJson("/drafts/" + id + "/regenerate-comment", {});
            if (!result.ok) throw new Error(result.error || "Yorum uretilemedi");
            const commentEl = qs('[data-field="comment"]', card);
            if (commentEl) {
              commentEl.value = result.comment_tr || "";
            }
            card.dataset.useComment = "true";
            const useCommentCheck = qs('[data-field="use-comment"]', card);
            if (useCommentCheck) useCommentCheck.checked = true;
            setMessage(card, "Yorum yenilendi.", "success");
          }
        } catch (error) {
          setMessage(card, error.message || "İslem basarisiz.", "error");
        } finally {
          setLoading(card, false);
          updatePreview(card);
        }
      }

      document.addEventListener("input", (event) => {
        const card = getCard(event.target);
        if (!card) return;
        if (event.target.matches("[data-field]")) {
          if (event.target.matches('[data-field="use-comment"]')) {
            card.dataset.useComment = event.target.checked ? "true" : "false";
          }
          updatePreview(card);
        }
      });

      document.addEventListener("change", (event) => {
        const card = getCard(event.target);
        if (!card) return;
        if (event.target.matches('[data-field="use-comment"]')) {
          card.dataset.useComment = event.target.checked ? "true" : "false";
          updatePreview(card);
        }
      });

      document.addEventListener("click", async (event) => {
        const bulkBtn = event.target.closest('[data-action="bulk-approve"]');
        if (bulkBtn) {
          const count = Number(bulkBtn.dataset.bulkCount || 10);
          if (!confirm("Viral skoru en yuksek " + count + " pending draft onaylanip siraya eklensin mi?")) return;
          bulkBtn.disabled = true;
          try {
            const r = await sendJson("/drafts/bulk-approve", { count });
            if (!r.ok) throw new Error(r.error || "bulk approve failed");
            location.reload();
          } catch (e) {
            alert(e.message || "Bulk onay basarisiz.");
            bulkBtn.disabled = false;
          }
          return;
        }

        const bulkRejectBtn = event.target.closest('[data-action="bulk-reject"]');
        if (bulkRejectBtn) {
          const cards = document.querySelectorAll(".draftCard");
          const ids = Array.from(cards).map((c) => c.dataset.id).filter(Boolean).map(Number);
          if (ids.length === 0) {
            alert("Sayfada reject edilecek draft yok.");
            return;
          }
          if (!confirm("Sayfadaki " + ids.length + " draft rejected yapilsin mi?")) return;
          bulkRejectBtn.disabled = true;
          try {
            const r = await sendJson("/drafts/bulk-reject", { ids });
            if (!r.ok) throw new Error(r.error || "bulk reject failed");
            location.reload();
          } catch (e) {
            alert(e.message || "Reject All basarisiz.");
            bulkRejectBtn.disabled = false;
          }
          return;
        }

        const clearRejectedBtn = event.target.closest('[data-action="clear-rejected"]');
        if (clearRejectedBtn) {
          if (!confirm("Rejected listesindeki tum kayitlar silinecek. Emin misiniz?")) return;
          clearRejectedBtn.disabled = true;
          try {
            const r = await sendJson("/clear-drafts", { status: "rejected" });
            if (!r.ok) throw new Error(r.error || "Bosaltma basarisiz");
            alert((r.deletedCount ?? 0) + " kayit silindi. Sayfa yenileniyor.");
            location.reload();
          } catch (e) {
            alert(e.message || "Rejected bosaltma basarisiz.");
            clearRejectedBtn.disabled = false;
          }
          return;
        }

        const clearPostedBtn = event.target.closest('[data-action="clear-posted"]');
        if (clearPostedBtn) {
          if (!confirm("Posted listesindeki tum kayitlar silinecek. History kayitlari da silinir. Emin misiniz?")) return;
          clearPostedBtn.disabled = true;
          try {
            const r = await sendJson("/clear-drafts", { status: "posted" });
            if (!r.ok) throw new Error(r.error || "Bosaltma basarisiz");
            alert((r.deletedCount ?? 0) + " kayit silindi. Sayfa yenileniyor.");
            location.reload();
          } catch (e) {
            alert(e.message || "Posted bosaltma basarisiz.");
            clearPostedBtn.disabled = false;
          }
          return;
        }

        const button = event.target.closest("button[data-action]");
        if (!button) return;
        handleAction(button);
      });

${renderScheduleSettingsScriptBody()}

      qsa(".draftCard").forEach(updatePreview);
    })();
  </script>`;
}

function renderSourcesClientScript() {
  return `
  <script>
    (() => {
      function qs(selector, root = document) {
        return root.querySelector(selector);
      }

      function qsa(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
      }

      async function sendJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        return response.json();
      }

${renderSourceManagementScriptBody()}
    })();
  </script>`;
}

function renderQueueClientScript() {
  return `
  <script>
    (() => {
      function qs(selector, root = document) {
        return root.querySelector(selector);
      }

      function qsa(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
      }

      async function sendJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        return response.json();
      }

      function updateEmptyState() {
        const hasRows = document.querySelectorAll("tbody tr[data-queue-id]").length > 0;
        const empty = document.getElementById("queueEmptyState");
        if (empty) {
          empty.classList.toggle("hidden", hasRows);
        }
      }

      function showFlash(text, kind) {
        const flash = document.getElementById("queueFlash");
        if (!flash) return;
        flash.className = "flash show " + (kind || "success");
        flash.textContent = text;
      }

      document.addEventListener("click", async (event) => {
        const button = event.target.closest('button[data-action="cancel-queue"]');
        if (!button) return;
        if (!confirm("Bu queue kaydi iptal edilsin mi? Sonrakiler yeniden schedule edilecek.")) {
          return;
        }

        button.disabled = true;
        try {
          const response = await fetch("/queue/" + button.dataset.queueId + "/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          const json = await response.json();
          if (!json.ok) throw new Error(json.error || "cancel failed");

          const row = button.closest("tr");
          if (row) row.remove();
          updateEmptyState();
          showFlash("Queue kaydi iptal edildi.", "success");
        } catch (error) {
          showFlash(error.message || "Queue iptali basarisiz.", "error");
          button.disabled = false;
        }
      });

${renderScheduleSettingsScriptBody()}

      updateEmptyState();
    })();
  </script>`;
}

function renderFollowClientScript() {
  return `
  <script>
    (function() {
      function qs(sel, root) { return (root || document).querySelector(sel); }
      async function sendJson(url, body) {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        return r.json();
      }
      function setFollowMessage(text, kind) {
        const el = document.getElementById("followMessage");
        if (!el) return;
        el.className = "message show " + (kind || "info");
        el.textContent = text;
      }
      document.addEventListener("submit", async (e) => {
        const form = e.target;
        if (!form || form.id !== "followAddForm") return;
        e.preventDefault();
        const handle = (qs("#followHandle", form)?.value || "").trim().replace(/^@/, "");
        if (!handle) {
          setFollowMessage("Kullanici adi girin.", "error");
          return;
        }
        const btn = qs("[data-follow-submit]", form);
        if (btn) btn.disabled = true;
        try {
          const r = await sendJson("/follow-queue", { handle });
          if (!r.ok) throw new Error(r.error || "Ekleme basarisiz");
          setFollowMessage("Eklendi. Sayfa yenileniyor...", "success");
          setTimeout(() => location.reload(), 600);
        } catch (err) {
          setFollowMessage(err.message || "Hata", "error");
          if (btn) btn.disabled = false;
        }
      });
      document.addEventListener("click", async (e) => {
        const del = e.target.closest('[data-action="delete-follow"]');
        if (del) {
          const id = del.dataset.id;
          if (!confirm("Bu kayit silinsin mi?")) return;
          del.disabled = true;
          try {
            const r = await sendJson("/follow-queue/" + id + "/delete", {});
            if (!r.ok) throw new Error(r.error || "Silme basarisiz");
            del.closest("tr")?.remove();
          } catch (err) {
            setFollowMessage(err.message || "Hata", "error");
          }
          del.disabled = false;
          return;
        }
        const retry = e.target.closest('[data-action="retry-follow"]');
        if (retry) {
          const id = retry.dataset.id;
          retry.disabled = true;
          try {
            const r = await sendJson("/follow-queue/" + id + "/retry", {});
            if (!r.ok) throw new Error(r.error || "Retry basarisiz");
            setFollowMessage("next_follow_at sifirlandi. Sayfa yenileniyor...", "success");
            setTimeout(() => location.reload(), 600);
          } catch (err) {
            setFollowMessage(err.message || "Hata", "error");
            retry.disabled = false;
          }
          return;
        }
      });
    })();
  </script>`;
}

function renderCollectorClientScript() {
  return `
  <script>
    (function() {
      async function sendJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        return response.json();
      }

      function setCollectorMessage(text, kind) {
        const el = document.getElementById("collectorMessage");
        if (!el) return;
        el.className = "message show " + (kind || "info");
        el.textContent = text;
      }

      document.addEventListener("click", async (event) => {
        const btn = event.target.closest('[data-action="run-collector"]');
        if (btn) {
          btn.disabled = true;
          try {
            const r = await sendJson("/run-collector", {});
            if (!r.ok) throw new Error(r.error || "Collector basarisiz");
            setCollectorMessage(r.message || "Collector baslatildi.", "success");
            btn.disabled = false;
          } catch (e) {
            setCollectorMessage(e.message || "Hata", "error");
            btn.disabled = false;
          }
          return;
        }

        const btn2 = event.target.closest('[data-action="run-make-drafts"]');
        if (btn2) {
          btn2.disabled = true;
          try {
            const r = await sendJson("/run-make-drafts", {});
            if (!r.ok) throw new Error(r.error || "Make-drafts basarisiz");
            setCollectorMessage(r.message || "Make-drafts baslatildi.", "success");
            btn2.disabled = false;
          } catch (e) {
            setCollectorMessage(e.message || "Hata", "error");
            btn2.disabled = false;
          }
          return;
        }

        const btnCancel = event.target.closest('[data-action="cancel-make-drafts"]');
        if (btnCancel) {
          btnCancel.disabled = true;
          try {
            const r = await sendJson("/cancel-make-drafts", {});
            setCollectorMessage(r.message || "Make-drafts iptal edildi.", "success");
          } catch (e) {
            setCollectorMessage(e.message || "Hata", "error");
          }
          btnCancel.disabled = false;
        }
      });
    })();
  </script>`;
}

function renderReplyClientScript() {
  return `
  <script>
    (function() {
      function qs(s,r){return(r||document).querySelector(s);}
      async function sendJson(url,body){
        const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
        return r.json();
      }
      function setMsg(text,kind){
        const el=document.getElementById("replyMessage");
        if(!el)return;
        el.className="message show "+(kind||"info");
        el.textContent=text;
      }
      function setSourceMsg(text,kind){
        const el=document.getElementById("replySourceMessage");
        if(!el)return;
        el.className="message show "+(kind||"info");
        el.textContent=text;
      }
      document.addEventListener("submit",async(e)=>{
        if(e.target?.id==="replySourceAddForm"){
          e.preventDefault();
          const h=(qs("#replySourceHandle",e.target)?.value||"").trim().replace(/^@/,"");
          if(!h){setSourceMsg("Handle girin","error");return;}
          try{
            const r=await sendJson("/reply-sources",{handle:h});
            if(!r.ok)throw new Error(r.error||"Ekleme basarisiz");
            setSourceMsg("Eklendi. Yenileniyor...","success");
            setTimeout(()=>location.reload(),600);
          }catch(err){
            setSourceMsg(err.message||"Hata","error");
          }
        }
      });
      document.addEventListener("click",async(e)=>{
        const runCollector=e.target.closest('[data-action="run-reply-collector"]');
        if(runCollector){
          runCollector.disabled=true;
          try{
            const r=await sendJson("/run-reply-collector",{});
            if(!r.ok)throw new Error(r.error||"Basarisiz");
            setMsg(r.message||"Baslatildi.","success");
          }catch(err){setMsg(err.message||"Hata","error");}
          runCollector.disabled=false;
          return;
        }
        const runDrafts=e.target.closest('[data-action="run-make-reply-drafts"]');
        if(runDrafts){
          runDrafts.disabled=true;
          try{
            const r=await sendJson("/run-make-reply-drafts",{});
            if(!r.ok)throw new Error(r.error||"Basarisiz");
            setMsg(r.message||"Baslatildi.","success");
          }catch(err){setMsg(err.message||"Hata","error");}
          runDrafts.disabled=false;
          return;
        }
        const del=e.target.closest('[data-action="delete-reply-source"]');
        if(del){
          const id=del.dataset.id;
          if(!confirm("Silinsin mi?"))return;
          del.disabled=true;
          try{
            const r=await sendJson("/reply-sources/"+id+"/delete",{});
            if(!r.ok)throw new Error(r.error);
            del.closest("tr")?.remove();
          }catch(err){setSourceMsg(err.message,"error");}
          del.disabled=false;
          return;
        }
        const approve=e.target.closest('[data-action="approve-reply"]');
        if(approve){
          const id=approve.dataset.id;
          approve.disabled=true;
          try{
            const r=await sendJson("/reply-drafts/"+id+"/approve",{});
            if(!r.ok)throw new Error(r.error||"Basarisiz");
            setMsg("Onaylandi, kuyruga eklendi.","success");
            setTimeout(()=>location.reload(),800);
          }catch(err){setMsg(err.message,"error");approve.disabled=false;}
          return;
        }
        const reject=e.target.closest('[data-action="reject-reply"]');
        if(reject){
          const id=reject.dataset.id;
          reject.disabled=true;
          try{
            const r=await sendJson("/reply-drafts/"+id+"/reject",{});
            if(!r.ok)throw new Error(r.error);
            reject.closest("tr")?.remove();
          }catch(err){setMsg(err.message,"error");reject.disabled=false;}
          return;
        }
      });
    })();
  </script>`;
}

function renderNewsClientScript() {
  return `
  <script>
    (function(){
      function qs(s,c){ return (c||document).querySelector(s); }
      async function sendJson(url,body){
        const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
        return r.json();
      }
      function setMsg(text,kind){
        const el=document.getElementById("newsMessage");
        if(!el)return;
        el.className="message show "+(kind||"info");
        el.textContent=text;
      }
      function setSourceMsg(text,kind){
        const el=document.getElementById("newsSourceMessage");
        if(!el)return;
        el.className="message show "+(kind||"info");
        el.textContent=text;
      }
      document.addEventListener("submit",async(e)=>{
        if(e.target?.id==="newsSourceAddForm"){
          e.preventDefault();
          const name=(qs("#newsSourceName",e.target)?.value||"").trim();
          const feedUrl=(qs("#newsSourceFeedUrl",e.target)?.value||"").trim();
          if(!name||!feedUrl){setSourceMsg("Ad ve URL girin","error");return;}
          try{
            const r=await sendJson("/news-sources",{name,feed_url:feedUrl});
            if(!r.ok)throw new Error(r.error||"Ekleme basarisiz");
            setSourceMsg("Eklendi. Yenileniyor...","success");
            setTimeout(()=>location.reload(),600);
          }catch(err){setSourceMsg(err.message||"Hata","error");}
        }
      });
      document.addEventListener("click",async(e)=>{
        const runCollector=e.target.closest('[data-action="run-news-collector"]');
        if(runCollector){
          runCollector.disabled=true;
          try{
            const r=await sendJson("/run-news-collector",{});
            if(!r.ok)throw new Error(r.error||"Basarisiz");
            setMsg(r.message||"Baslatildi. Sayfayi yenileyin.","success");
          }catch(err){setMsg(err.message||"Hata","error");}
          runCollector.disabled=false;
          return;
        }
        const runDrafts=e.target.closest('[data-action="run-make-news-drafts"]');
        if(runDrafts){
          runDrafts.disabled=true;
          try{
            const r=await sendJson("/run-make-news-drafts",{});
            if(!r.ok)throw new Error(r.error||"Basarisiz");
            setMsg(r.message||"Baslatildi. Sayfayi yenileyin.","success");
          }catch(err){setMsg(err.message||"Hata","error");}
          runDrafts.disabled=false;
          return;
        }
        const del=e.target.closest('[data-action="delete-news-source"]');
        if(del){
          const id=del.dataset.id;
          if(!confirm("Silinsin mi?"))return;
          del.disabled=true;
          try{
            const r=await sendJson("/news-sources/"+id+"/delete",{});
            if(!r.ok)throw new Error(r.error);
            del.closest("tr")?.remove();
          }catch(err){setSourceMsg(err.message,"error");}
          del.disabled=false;
          return;
        }
        const postNow=e.target.closest('[data-action="post-news-now"]');
        if(postNow){
          const id=postNow.dataset.id;
          if(!confirm("Bu post simdi paylasilsin mi?"))return;
          postNow.disabled=true;
          try{
            const r=await sendJson("/news-drafts/"+id+"/post-now",{});
            if(!r.ok)throw new Error(r.error||"Paylasim basarisiz");
            setMsg("Paylasildi. x_post_id="+(r.xPostId||"?"),"success");
            const row=postNow.closest("tr");
            if(row){
              const pill=row.querySelector(".pill");
              if(pill){pill.textContent="posted";pill.className="pill posted";}
              postNow.remove();
            }
          }catch(err){setMsg(err.message||"Hata","error");postNow.disabled=false;}
          return;
        }
      });
    })();
  </script>`;
}

module.exports = {
  renderInboxClientScript,
  renderQueueClientScript,
  renderSourcesClientScript,
  renderCollectorClientScript,
  renderFollowClientScript,
  renderReplyClientScript,
  renderNewsClientScript,
};
