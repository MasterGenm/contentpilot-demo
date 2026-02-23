# components/persona_selector.py
"""
Client Agent 人设选择组件
提供用户界面选择不同的Agent人设
"""

import mesop as me
from typing import List, Dict, Any
from state.state import AppState


def render_persona_selector():
    """渲染人设选择器"""
    state = me.state(AppState)
    
    with me.box(
        style=me.Style(
            background="#ffffff",
            border_radius=12,
            padding=me.Padding.all(16),
            margin=me.Margin.all(8),
            box_shadow="0 2px 8px rgba(0,0,0,0.1)"
        )
    ):
        # 标题
        me.text(
            "🎭 选择 AI 人设",
            style=me.Style(
                font_size=18,
                font_weight=600,
                margin=me.Margin(bottom=12)
            )
        )
        
        # 当前激活的人设显示
        me.text(
            f"当前人设: {state.active_persona_id}",
            style=me.Style(
                font_size=14,
                color="#666",
                margin=me.Margin(bottom=16)
            )
        )
        
        # 人设卡片网格
        with me.box(
            style=me.Style(
                display="grid",
                grid_template_columns="repeat(auto-fill, minmax(200px, 1fr))",
                gap=12
            )
        ):
            # 这里会动态加载可用的人设
            render_persona_card("assistant", "🤖", "通用助手", "友好专业的AI助手")
            render_persona_card("researcher", "🔬", "研究分析师", "深度调研和数据分析")
            render_persona_card("creative", "🎨", "创意策划师", "富有创意的内容创作")
            render_persona_card("technical", "👨‍💻", "技术专家", "精通编程和技术问题")


def render_persona_card(persona_id: str, emoji: str, name: str, description: str):
    """渲染单个人设卡片"""
    state = me.state(AppState)
    is_active = state.active_persona_id == persona_id
    
    with me.box(
        key=f"persona_{persona_id}",
        on_click=lambda e, pid=persona_id: select_persona(e, pid),
        style=me.Style(
            background="#f8f9fa" if not is_active else "#e3f2fd",
            border=me.Border.all(
                me.BorderSide(
                    width=2,
                    color="#2196f3" if is_active else "#e0e0e0",
                    style="solid"
                )
            ),
            border_radius=8,
            padding=me.Padding.all(12),
            cursor="pointer",
            transition="all 0.2s ease"
        )
    ):
        # Emoji 图标
        me.text(
            emoji,
            style=me.Style(
                font_size=32,
                text_align="center",
                margin=me.Margin(bottom=8)
            )
        )
        
        # 人设名称
        me.text(
            name,
            style=me.Style(
                font_size=16,
                font_weight=600,
                text_align="center",
                margin=me.Margin(bottom=4)
            )
        )
        
        # 人设描述
        me.text(
            description,
            style=me.Style(
                font_size=12,
                color="#666",
                text_align="center",
                line_height="1.4"
            )
        )
        
        # 激活标识
        if is_active:
            me.text(
                "✓ 已激活",
                style=me.Style(
                    font_size=11,
                    color="#2196f3",
                    text_align="center",
                    margin=me.Margin(top=8),
                    font_weight=500
                )
            )


def select_persona(e: me.ClickEvent, persona_id: str):
    """选择人设"""
    state = me.state(AppState)
    
    # 更新状态
    state.active_persona_id = persona_id
    
    # 这里可以触发人设切换的其他逻辑
    # 比如重新加载系统提示词、更新模型配置等
    print(f"已切换到人设: {persona_id}")


def render_persona_dialog():
    """渲染人设选择对话框"""
    state = me.state(AppState)
    
    if not state.persona_selector_open:
        return
    
    with me.box(
        style=me.Style(
            position="fixed",
            top=0,
            left=0,
            right=0,
            bottom=0,
            background="rgba(0,0,0,0.5)",
            display="flex",
            align_items="center",
            justify_content="center",
            z_index=1000
        )
    ):
        with me.box(
            style=me.Style(
                background="#ffffff",
                border_radius=16,
                padding=me.Padding.all(24),
                max_width=800,
                width="90%",
                max_height="80vh",
                overflow_y="auto"
            )
        ):
            # 对话框头部
            with me.box(
                style=me.Style(
                    display="flex",
                    justify_content="space-between",
                    align_items="center",
                    margin=me.Margin(bottom=20)
                )
            ):
                me.text(
                    "选择 AI 人设",
                    style=me.Style(
                        font_size=24,
                        font_weight=600
                    )
                )
                
                me.button(
                    "✕",
                    on_click=close_persona_dialog,
                    style=me.Style(
                        background="transparent",
                        border=me.Border.all(me.BorderSide(width=0)),
                        font_size=24,
                        cursor="pointer",
                        padding=me.Padding.all(4)
                    )
                )
            
            # 人设选择器内容
            render_persona_selector()


def close_persona_dialog(e: me.ClickEvent):
    """关闭人设对话框"""
    state = me.state(AppState)
    state.persona_selector_open = False


def open_persona_dialog(e: me.ClickEvent):
    """打开人设对话框"""
    state = me.state(AppState)
    state.persona_selector_open = True


def render_persona_header_button():
    """渲染头部的人设切换按钮"""
    state = me.state(AppState)
    
    # 获取当前人设的emoji（简化版）
    persona_emojis = {
        "assistant": "🤖",
        "researcher": "🔬",
        "creative": "🎨",
        "technical": "👨‍💻"
    }
    current_emoji = persona_emojis.get(state.active_persona_id, "🤖")
    
    me.button(
        f"{current_emoji} {state.active_persona_id}",
        on_click=open_persona_dialog,
        style=me.Style(
            background="#e3f2fd",
            color="#1976d2",
            border=me.Border.all(
                me.BorderSide(width=1, color="#90caf9", style="solid")
            ),
            border_radius=20,
            padding=me.Padding(top=8, bottom=8, left=16, right=16),
            font_size=14,
            font_weight=500,
            cursor="pointer",
            transition="all 0.2s ease"
        )
    )

