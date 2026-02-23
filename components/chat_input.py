# components/chat_input.py (新文件)

import mesop as me
from typing import Callable

# 定义背景色，使其能适应深色/浅色模式
BACKGROUND_COLOR = me.theme_var("surface-container")

@me.component
def chat_input(
    *,
    on_input: Callable,
    on_submit_shortcut: Callable,
    on_submit_click: Callable,
    value: str,
    disabled: bool,
):
    """
    一个从官方示例改编而来的、可重用的、样式精美的聊天输入组件。
    它接收所有必要的事件处理器和状态作为参数。
    """
    with me.box(
        style=me.Style(
            padding=me.Padding.symmetric(vertical=8, horizontal=24),
            border=me.Border(top=me.BorderSide(style="solid", width=1, color=me.theme_var("outline-variant"))),
        )
    ):
        with me.box(
            style=me.Style(
                max_width="900px",
                margin=me.Margin.symmetric(horizontal="auto"),
                padding=me.Padding.all(8),
                background=BACKGROUND_COLOR,
                display="flex",
                border_radius=16,
                align_items="flex-end",
                gap=8,
            )
        ):
            with me.box(style=me.Style(flex_grow=1)):
                me.native_textarea(
                    key="chat_input",
                    on_input=on_input,
                    value=value, # 绑定 value 以便在提交后清空
                    placeholder="输入您的问题 (Shift+Enter 发送)...",
                    autosize=True,
                    min_rows=1,
                    max_rows=5,
                    shortcuts={
                        me.Shortcut(shift=True, key="Enter"): on_submit_shortcut,
                    },
                    style=me.Style(
                        background=BACKGROUND_COLOR,
                        outline="none",
                        width="100%",
                        border=me.Border.all(me.BorderSide(style="none")),
                        padding=me.Padding(top=10, left=10),
                        color=me.theme_var("on-surface-variant"),
                    ),
                )
            
            with me.content_button(
                on_click=on_submit_click,
                disabled=disabled,
                type="icon",
                style=me.Style(flex_shrink=0)
            ):
                me.icon("send")