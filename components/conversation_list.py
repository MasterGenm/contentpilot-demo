# components/conversation_list.py
import mesop as me
from state.state import AppState
import hashlib

def _short_id(raw: str) -> str:
    if not raw:
        return "Unsaved"
    if len(raw) <= 10:
        return raw
    return f"{raw[:6]}…{raw[-4:]}"

def _hash_if_needed(text: str) -> str:
    if not text:
        return "Unsaved"
    # 如果是临时名，给个稳定截断哈希
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]
    return f"{text[:12]}… ({h})" if len(text) > 14 else text

def conversation_list():
    st = me.state(AppState)

    # 计算展示用字段
    conv_id = getattr(st, "conversation_id", None)
    conv_name = getattr(st, "conversation_name", None)
    model_name = getattr(st, "selected_model", "naga:default") or "naga:default"
    show_id = _short_id(conv_id or "")
    show_name = _hash_if_needed(conv_name or model_name)
    msg_count = len(getattr(st, "messages", []) or [])

    with me.box(style=me.Style(padding=me.Padding.all(0))):
        # 标题
        with me.box(style=me.Style(
            padding=me.Padding.symmetric(vertical=8, horizontal=12),
            border=me.Border(bottom=me.BorderSide(style="solid", width=1, color=me.theme_var("outline-variant")))
        )):
            me.text("会话", type="subtitle-1")

        # 表头（尽量用 Mesop 允许的字体等级）
        with me.box(style=me.Style(
            display="flex",
            padding=me.Padding.symmetric(vertical=6, horizontal=12),
            color=me.theme_var("on-surface-variant")
        )):
            with me.box(style=me.Style(width="38%")): me.text("ID / Name", type="caption")
            with me.box(style=me.Style(width="62%")): me.text("概要", type="caption")

        # 单条（当前会话）
        with me.box(style=me.Style(
            display="flex",
            padding=me.Padding.symmetric(vertical=10, horizontal=12),
            align_items="flex-start",
            border=me.Border(bottom=me.BorderSide(style="solid", width=1, color=me.theme_var("outline-variant")))
        )):
            # 左：ID + Name
            with me.box(style=me.Style(width="38%")):
                me.text(show_id, type="body-2")
                me.text(show_name, type="caption", style=me.Style(color=me.theme_var("on-surface-variant")))

            # 右：概要（messages 合并 status）
            with me.box(style=me.Style(width="62%")):
                # 这里把 Status 合并为一句话概要；若将来有状态再替换
                summary = f"{msg_count} messages"
                me.text(summary, type="body-2")
